# TrailMate — Architecture & Design Choices

How the production app ([`web/`](../web/)) is put together, and the trade-offs
behind each choice. TrailMate began as a Python CLI prototype; its ideas were
ported here and the prototype was removed (see git history for the old code and
the original version of this document).

---

## 1. One agent, one bounded loop

The heart of the app is a single tool-calling loop
([`chat.service.ts`](../web/server/modules/chat/chat.service.ts)): the model
picks tools, results are fed back as observations, and it iterates until it
produces a final answer — capped at 10 iterations. Tool failures are returned
as structured `{status: "error"}` results the model can see and recover from,
rather than exceptions that kill the turn.

**Trade-off:** a reactive loop with no explicit planning step. The "plan" lives
in the prompt (region first, then trails, then weather/places, then present).
That's enough for a multi-day trip; a task needing long-horizon coherence would
want an externalized plan the agent checks off.

## 2. Deterministic guardrails around the agent

The loop deliberately takes some control away from the model:

- Once trail search starts, streamed prose is suppressed — the user sees a live
  checklist of tool steps, and the finished plan appears in the notebook, not
  as chat text.
- The moment a concrete itinerary is presented, the loop **stops**. The model
  never gets another turn to re-type the plan as prose.
- If the agent planned but forgot to call `present_itinerary`, a forced,
  `tool_choice`-pinned call converts its prose plan into structured data.
- On edits, fields the model dropped while regenerating (links, URLs) are
  backfilled from the previous version by name-matching, in code.

**Trade-off:** reliability is bought by shrinking the agent's decision surface.
These guardrails exist because "always call the tool at the end" prompt rules
are followed only *usually* — product behavior can't hinge on *usually*.

## 3. Tools: one Zod source of truth

Every tool's arguments are defined once as a Zod schema in
[`tools.schemas.ts`](../web/server/agent/tools.schemas.ts). The JSON Schema
advertised to the model is **generated** from those specs, and incoming calls
are validated (and coerced — `"6"` → `6`) by the same specs, so the announced
contract and the enforced one cannot drift. Executors in
[`tools.ts`](../web/server/agent/tools.ts) receive typed, validated args and
just delegate to services; a failed parse returns a structured error the model
can observe and retry on.

**Trade-off:** stricter than passthrough — a malformed `present_itinerary` day
now fails loudly instead of rendering half-broken. The loop's retry absorbs
this, but it's a deliberate change of failure mode: visible-and-retried beats
silent-and-wrong.

## 4. Skills: instructions in the prompt, detail on demand

Capability-specific instructions live as modules in
[`skills/`](../web/server/agent/skills/), injected into the system prompt as an
`<available_skills>` block. Long-tail detail (feature-tag glossary, region
aliases, itinerary field layout) is *not* in the prompt — the agent fetches it
with a `read_reference` tool when needed. The region reference is generated
from the live gazetteer at load time, so documentation can't drift from what
the server resolves.

**Trade-off:** the prototype's skills were markdown files plus a generic
`run_script` tool — maximally extensible, but loose (the model had to compose
shell commands) and impossible on a serverless bundle. Skills as TS modules
give up "add a skill without touching code" and gain type-checking,
bundler-safety, and single-sourcing. Progressive disclosure survives via
`read_reference`.

## 5. Context: token-budgeted, compact-on-read

[`context.ts`](../web/server/agent/context.ts) tracks token spend (tiktoken,
o200k) and, when history crosses a 32k budget, applies tiered compaction:

1. Evict old tool payloads (fat search-result JSON is dead weight after the
   plan is composed).
2. Keep only the last N message *groups* — an assistant tool-call and its tool
   results always travel together, so eviction can never orphan a tool message
   (the OpenAI API rejects that).
3. Summarize the discarded middle into one synthetic system message
   (small model).

Compaction is **return-view only**: the stored history is never mutated; each
iteration recomputes a compacted view.

**Trade-off:** tier 1 evicts *all* tool payloads, including recent ones. At a
32k budget this effectively never fires mid-turn, and view-only compaction
means nothing is ever lost — only not sent.

## 6. Sessions: refresh loses nothing, and there is no chat history list

The server owns conversation history (`chat_sessions` / `chat_messages`,
RLS-scoped per user). The client sends only its new message plus a session id;
on load it restores the current chat. The session also stores the last
presented-but-unsaved itinerary, which is (a) restored to the notebook on
refresh and (b) fed back to the agent as edit context — so the agent remembers
what it proposed even across a reload.

Deliberate UX rule: the only reachable conversations are the **current chat**
and the chat attached to each **saved trip** (saving stamps `trip_id` onto the
session; opening the trip brings its conversation back). There is no
list-all-chats endpoint at all — abandoned chats stay stored but unreachable.

**Trade-off:** users can't dig up an old unsaved conversation. That's the
product intent: trips are the durable artifact, chats are the scaffolding.

## 7. Trail data: a curated catalog + semantic search, OSM as fallback

The primary trail source is a Supabase catalog (~800 real Israeli trails
scraped from tiuli.co.il and nakeb.co.il, embedded with
`text-embedding-3-small`). `search_tiuli` ranks by semantic similarity to the
free-form intent, then narrows with hard filters (region, length, difficulty,
feature tags). English place names resolve to Hebrew search tokens through a
deterministic gazetteer instead of trusting the LLM to recall exact Hebrew
strings. `search_trails` (OpenStreetMap) is the geographic fallback.

The catalog is seeded from [`.agents/data/trails_seed.json`](../.agents/data/)
via `npm run seed`; the Python scrapers that built that file live in git
history.

**Trade-off:** intent lives in the embedding query, constraints in filters. A
hard feature filter can hide an untagged-but-matching trail, so the prompt
teaches the agent to state must-haves in *both* the query and the filter.

## 8. Layering: controller → service → dbservice

Every module ([`web/server/modules/`](../web/server/modules/)) follows the same
shape: a **controller** (HTTP adapter: auth, parsing, streaming), a **service**
(business logic; the chat service *is* the agent loop), and a **dbservice**
(queries only). User-facing reads/writes run on the request's RLS-bound
Supabase client, so ownership is enforced by Postgres, not just app code;
system tasks (the reminder cron) use the service-role client.

## 9. The proactive layer (and its current limits)

A daily Vercel cron finds trips whose next day is tomorrow (Israel time),
generates a short summary with one LLM call, and sends it via Telegram —
deduplicated per trip/day/chat. The Telegram webhook currently handles account
linking only.

**Honest status:** this is a rule-based pipeline with an LLM formatter, not an
agent. The natural next steps — letting the reminder job check live weather
and *decide* (warn, suggest an earlier start, propose a shadier alternative),
and piping Telegram messages into the chat agent — are known TODOs, alongside
a pre-present itinerary verifier (geo-coherence, difficulty sanity) and
user-preference memory, which was considered and deliberately not built.
