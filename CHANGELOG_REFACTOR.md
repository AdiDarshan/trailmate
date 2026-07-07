# Refactor log — codebase vs REVIEW.md rubric

Running record, one section per module, written as each module lands (in risk
order: auth/db → chat → trip → telegram → reminder → agent → data services →
routes → client). Axes per REVIEW.md: **Q**uality, **E**rror handling,
**T**ests, **O**bservability.

## Ground rules applied

- No public API / behavior changes except where required to fix a real bug or
  rubric violation; every such case is flagged with ⚠️ below.
- "External call" = OpenAI, Supabase, Telegram, Nominatim, Overpass, IHM,
  Open-Meteo, fetch of any kind — each wrapped and logged with latency.
- Judgment call: controllers bound to Next.js runtime internals (`cookies()`,
  streaming `Request`) and thin dbservices (1:1 Supabase query wrappers) are
  exercised through logic-level tests of what they delegate to, not through
  mocked-transport unit tests, which would test the mock. Flagged per module.

## shared (new)

- **O:** `server/shared/logger.ts` — structured one-line-JSON logger
  (`createLogger(module)`), with `timed(event, fields, fn)` as the standard
  latency+outcome wrapper for every external call. Zero-dep by design (a
  logging library would be an unapproved dependency addition).
- **E:** `server/shared/errors.ts` — `AppError` with `publicMessage` +
  `toPublicMessage()`: internal detail goes to logs, users get a safe message.
- **T:** `logger.test.ts` — happy path + unserializable-fields edge +
  timed() ok/error paths + public/internal message separation.

## server/db (auth critical path)

- **Q/E:** `supabase.ts` now initializes lazily behind a Proxy with the same
  `supabase.from(...)` surface. ⚠️ Deliberate change: missing env vars now
  fail at first DB use (typed `AppError`) instead of at import — same runtime
  guarantee, but modules that merely import a service are testable.
- **E/O:** `getAuthUser()` wraps the Supabase call; auth-infrastructure
  failures are logged (`auth_client_failed` / `get_user_failed` with status)
  and treated as signed-out (401) rather than surfacing a 500 with internals.
  ⚠️ Behavior note: a Supabase outage now reads as "not signed in" to the
  client — judged acceptable (user retries) vs leaking internal errors.
- The empty `catch` in `createAuthClient`'s cookie `setAll` is deliberate
  recovery (session refresh belongs to middleware, per @supabase/ssr docs) —
  kept, documented.
- **T:** judgment call — both functions are thin wrappers over `cookies()` +
  Supabase SDK; unit tests would mock everything they do. Covered indirectly
  by every controller path.

## modules/chat (public API, data writes, agent loop)

- **Q:** extracted pure logic to `chat.helpers.ts` (isConcreteItinerary,
  backfillTrail/Place, mergeEditedItinerary, STEP_LABELS) — service shrinks,
  helpers gain direct tests. Named constants for headers/session id length;
  duplicated maybeSingle/unwrap pattern in dbservice extracted to `unwrap()`.
- **E:** controller: session resolution + history load + user-message persist
  moved BEFORE the stream starts → failures return real HTTP statuses (404 for
  bad session, 500 generic) instead of a broken stream. ⚠️ Stream errors now
  send `toPublicMessage(e)` (generic) to the client instead of the raw internal
  message — internal detail goes to logs only. `assistant_persist_failed` and
  malformed tool-args JSON are logged, never swallowed.
- **O:** structured logs: `chat_request` (entry), `turn_start`/`turn_end`
  (outcome, iterations, total ms), `openai_chat`/`openai_summarize`/
  `openai_force_present`/`tool_call` all latency-timed, every dbservice query
  timed with outcome. `force_present_needed` warns when the safety net fires
  (a signal the prompt is drifting).
- **T:** `chat.helpers.test.ts` — 10 tests: concreteness rules, backfill
  restores dropped links but never overwrites genuine changes or different
  names, day-number matching, grown trips, empty-days passthrough.
- Judgment call: the streaming loop itself (OpenAI SDK + ReadableStream) is
  not unit-tested — mocking a token stream tests the mock; it's exercised by
  the in-process e2e smoke used before deploys.

## modules/trip (data writes)

- **E:** 🐞 **Bug fixed:** a session-link failure after a successful save used
  to 500 the whole request — the client would believe the save failed and
  retry, duplicating the trip. Linking is now best-effort: logged
  (`link_session_failed`), never fatal. Regression coverage is a judgment
  call: the fix is a try/catch placement in a cookies()-bound controller;
  asserted by review rather than a mocked-transport test.
- **E:** every controller handler now catches, logs with context (userId,
  tripId), and returns `toPublicMessage` — no more raw Next 500s with digests.
- **Q:** magic values named (`TRIP_ID_LENGTH`, `START_DATE_RE`); dbservice
  gets the same `unwrap()` treatment as chat's.
- **O:** `save_trip` entry log (isUpdate, day count); all queries latency-
  timed; telegram save-confirmation failure downgraded from console.error to
  structured `save_confirmation_failed` warn.

## modules/telegram (public webhook)

- **E:** 🐞 **P0 fixed:** `sendMessage` fetch was unwrapped — one network
  error killed the whole caller (the reminder cron mid-run). Now returns
  false on any failure (API rejection, network, missing token); callers treat
  delivery as best-effort. Regression tests cover all four paths.
- **E:** `markSent` (reminder dedupe) used to ignore insert errors → silent
  failure meant duplicate reminders the next day. Now throws so the caller
  can react; `consumeLinkToken`'s best-effort delete failure is logged.
- **O:** `send_message` logs outcome + latency + status detail;
  webhook logs `account_linked` / `start_without_valid_token` /
  `webhook_link_failed`; controller documents WHY it always answers 200
  (Telegram retry loop).
- **T:** `telegram.service.test.ts` — success (payload shape asserted),
  API rejection, network failure, missing token.
- Flagged, not changed: the webhook has no `secret_token` verification —
  anyone who finds the URL can POST fake updates. Real hardening, but it
  requires re-registering the webhook with Telegram (ops step), so it's a
  recommendation, not a silent change.

## modules/reminder (cron)

- **E:** 🐞 **P0 fixed:** the run had no per-trip isolation — one LLM error or
  DB hiccup aborted the entire cron mid-loop, silently skipping every
  remaining user (and the unwrapped `summarize` call made this likely). Now:
  each user and each trip is individually wrapped; the LLM call falls back to
  a plain reminder text on failure; the run always completes and reports
  `{sent, checked, failed}`. ⚠️ Additive response field `failed`.
- **Q:** date logic extracted to `reminder.helpers.ts` (israelToday now takes
  an injectable `now` for testability); constants named (SUMMARY_MODEL,
  FALLBACK_SUMMARY).
- **T:** `reminder.helpers.test.ts` — 8 tests including the UTC-midnight/
  Israel-timezone boundary, month/year rollover, and day_number clamping.
- **O:** `daily_run_start`/`daily_run_done` with totals, per-failure logs
  carrying tripId/userId, LLM call latency-timed, cron endpoint logs
  unauthorized attempts and times the whole run.

## server/agent (tools, context, skills, schemas)

- **O:** `context.ts` compaction/budget logs converted from console strings to
  structured records (tier, before/after msgs+tokens). `executeTool` logs
  unknown tools, validation issues, and executor failures WITH the (model-
  generated, non-sensitive) args so failures are reproducible. Tool latency is
  logged by the chat loop's `tool_call` timing.
- **E:** contract confirmed and documented: `executeTool` never throws into
  the agent loop — every failure is both logged and returned as a
  `{status:"error"}` observation.
- **Q:** OpenAI client for embeddings is a lazy per-process singleton (was:
  `new OpenAI()` per call).
- **T:** `tools.test.ts` — 7 dispatch tests (arg coercion + filter mapping,
  documented defaults, unknown tool, validation rejection short-circuits
  before any service call, executor throw → structured result, skill
  references, present_itinerary echo). Enabled by the lazy Supabase init.
  skills/schemas/context suites already existed (21 tests).

## modules/trail, modules/place, modules/weather (external data services)

- **E:** 🐞 **Bug fixed (weather):** an unparseable `date` ("next Saturday")
  reached `toISOString()` and died with `RangeError: Invalid time value`.
  `parseStartDate` now rejects garbage with a clear message; regression test
  included.
- **E:** trail `searchOSM` enrichment switched `Promise.all` →
  `Promise.allSettled`: ⚠️ one failed trail enrichment no longer sinks the
  other results (strictly more results on partial failure; logged per miss).
  Trail `embedQuery`'s silent catch now logs `embed_failed_fallback_to_text` —
  a missing key and an OpenAI outage were previously indistinguishable.
- **Q:** magic numbers named (weather advice thresholds VERY_HOT_C /
  STRONG_WIND_KMH / RAIN_CODES / SNOW_CODES, MS_PER_DAY); nominatim results
  NaN-checked (place already had bbox guards); pure functions exported for
  test (`formatForecast`, `formatElement`, `classifyDifficulty`,
  `estimateDuration`, `parseColor`, `rerankByRegion`).
- **O:** every Nominatim / Overpass / IHM / Open-Meteo / embeddings call runs
  through `log.timed` (host + latency + outcome); `catalog_search` logs which
  strategy matched (semantic / text / none) — the key signal for search
  quality tuning.
- **T:** 24 new tests across weather (advice thresholds, malformed API
  response, geocode failure, stubbed-fetch happy path, date regression),
  place (tag formatting, dedupe, unknown type short-circuits before network,
  geocode failure), trail (difficulty boundaries, duration rounding, OSMC
  parsing, region re-rank beats similarity, tie-breaks), and gazetteer
  (alias mapping, passthrough, blank input, all-tokens-are-Hebrew invariant).

## app routes, middleware, client (leaf)

- **E (auth path):** middleware's `getUser()` wrapped — a Supabase outage now
  reads as signed-out (redirect to /login) instead of a 500 on every route,
  and is logged. OAuth callback failures (`exchangeCodeForSession`) were
  silently swallowed — "login randomly doesn't work" is now
  `code_exchange_rejected`/`code_exchange_failed` in logs.
- **E (client):** `page.tsx` had a `try/finally` with no catch in the boot
  restore (unhandled promise rejection on network failure) and unhandled
  rejections in `openTrip`/`loadTrips`/`saveTrip` — all caught with
  explicit recovery choices (stale sidebar, keep view, Save stays visible).
- Judgment calls: API route files are 3-line adapters — no tests (nothing to
  test but the framework). Components (`components/*.tsx`) reviewed, left
  unchanged: presentation-only, no external calls, no empty catches; per the
  rubric's "don't reward breadth", churning them is risk without axis gains.
  `useAgent.ts` already handled fetch/stream errors correctly.

## Rubric items NOT done (explicit)

- Integration tests hitting a real DB (rubric: "critical paths have
  integration tests") — no test database exists in this repo; the RLS-bound
  paths are exercised by the pre-deploy in-process smoke instead. Setting up
  a Supabase test project is the right next step.
- Metrics emission (rubric: "critical operations emit a metric") — no metrics
  backend is configured. The structured logs carry count/duration/outcome
  fields, which Vercel log drains can aggregate; a real metrics pipe is an
  infra decision, not a code change.
- Telegram webhook `secret_token` (flagged under telegram) — needs an ops
  step (webhook re-registration), listed rather than silently changed.
