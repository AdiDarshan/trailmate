# TrailMate Web (Next.js → Vercel)

The production TrailMate app: a Next.js App Router app with a streaming agent
(OpenAI gpt-4o), a tiuli-backed trail catalog in Supabase, Google auth with
per-user trips, a live trip notebook, and proactive Telegram reminders.

🌐 Live: https://trailmate-theta.vercel.app

## Architecture

Stateless backend; the LLM orchestrates typed tools over a private DB + public
APIs and streams results to a thin React client. The server is **layered**:

```
app/api/*/route.ts   →  controller  →  service  →  db-service / external API
   (HTTP entry)          (HTTP)         (logic)      (data access)
```

- `app/` — UI (`page.tsx`, `components/`) + API routes (`app/api/**`).
- `server/modules/<domain>/` — `chat`, `trip`, `trail`, `place`, `weather`,
  `telegram`, `reminder`; each bundles its controller + service + db-service.
- `server/agent/` — the tool registry (thin adapters over services) + prompt.
- `server/db/` — `supabase.ts` (service-role, system tasks) and
  `supabase-auth.ts` (cookie/RLS-bound, the signed-in user).
- `lib/supabase-browser.ts` — browser client for sign-in/out.
- `middleware.ts` — auth gate (login required; machine endpoints excluded).

Tools: `search_tiuli` (Supabase catalog), `search_trails` (Israel Hiking Map /
Overpass), `search_places` (Nominatim / Overpass), `get_weather` (Open-Meteo),
`present_itinerary`.

## Prerequisites

- A **Supabase** project (free tier).
- An **OpenAI** API key.
- A **Telegram bot** (from @BotFather) — optional, for reminders.
- Google OAuth credentials — for sign-in.

## 1. Database

In the Supabase **SQL editor**, run these files from [`../supabase/`](../supabase/)
in order:

1. `schema.sql` — `trails` + `trips` tables, trigram search.
2. `auth.sql` — adds `user_id` to `trips` + Row-Level Security (run after enabling
   the Google provider, below).
3. `reminders.sql` — `start_date` on trips + reminder dedupe.
4. `telegram-link.sql` — account ↔ Telegram chat linking.

## 2. Google sign-in (Supabase Auth)

1. **Google Cloud Console** → APIs & Services → OAuth consent screen (External;
   add yourself as a test user) → **Credentials → Create OAuth client ID → Web**.
   Authorized redirect URI:
   `https://<your-project>.supabase.co/auth/v1/callback`
2. **Supabase** → Authentication → Providers → **Google** → enable, paste the
   Client ID + Secret → Save.
3. **Supabase** → Authentication → URL Configuration → set **Site URL** to your
   deployed URL and add `http://localhost:3000/**` to Redirect URLs.

## 3. Telegram reminders (optional)

1. Create a bot via **@BotFather** → get the token + username.
2. After deploying, register the webhook once:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>/api/telegram/webhook"
   ```
3. In the app sidebar, **Connect Telegram** links your account.

## 4. Environment variables

Copy `.env.local.example` → `.env.local` and fill in:

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | the agent (gpt-4o) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | server-only DB access (system) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser auth (public, RLS-limited) |
| `TELEGRAM_BOT_TOKEN` / `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | reminders |
| `CRON_SECRET` | protects the daily cron endpoint |

## 5. Install, seed, run

```bash
npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed   # load 348 trails
npm run dev                                                    # http://localhost:3000
```

## Deploy to Vercel

1. Import the repo; set **Root Directory = `web`**.
2. Add all the env vars above (Production + Preview + Development).
3. Deploy. The daily reminder cron is defined in `vercel.json` (18:00 Israel).

Note: heavy multi-tool trips can approach the Vercel Hobby 60s function cap
(`maxDuration` in `app/api/chat/route.ts`); Vercel Pro / Fluid Compute lifts it.
