# TrailMate

An AI travel companion that plans hiking trips in Israel — chat with it, get a
day-by-day itinerary (trail, meals, accommodation, weather), save your trips, and
get proactive reminders on Telegram.

🌐 **Live:** https://trailmate-theta.vercel.app

## What it does

- **Conversational trip planning** — describe a trip ("2 days in the Galilee
  next Saturday") and the agent builds a concrete day-by-day plan.
- **Real data** — a curated catalog of 348 Israeli trails (from tiuli.com) in
  Supabase, plus live OpenStreetMap (trails, restaurants, hotels) and Open-Meteo
  weather. Every place is a Google Maps link.
- **Accounts + saved trips** — sign in with Google; your trips are private to you
  (Postgres Row-Level Security). A sidebar lists your saved trips; reopen one to
  edit it.
- **Proactive Telegram reminders** — connect Telegram once to get a confirmation
  when you save a trip and a short summary the day before each day of a trip.

## Repository layout

This repo contains two things:

| Path | What it is |
|---|---|
| [`web/`](web/) | **The production app** — Next.js (App Router) + TypeScript, deployed on Vercel. This is what's live. |
| [`supabase/`](supabase/) | SQL migrations for the Supabase database. |
| [`.agents/data/`](.agents/data/) | The enriched trail dataset that seeds Supabase (`npm run seed`). The Python scrapers that built it live in git history. |

## Architecture (web app)

A stateless Next.js backend where the LLM orchestrates typed tools over a private
DB and public APIs, streaming results to a thin React client.

```
Browser ──▶ Next.js API (Vercel) ──▶ Supabase (trails, trips) + external APIs
```

The server is layered (controllers → services → db-services, grouped into
modules); tools are thin adapters over the services. See
[`web/README.md`](web/README.md) for the full breakdown.

- **Agent:** OpenAI `gpt-4o`, bounded tool-calling loop, token streaming.
- **Tools:** `search_tiuli` (Supabase catalog), `search_trails`
  (Israel Hiking Map / Overpass), `search_places` (Nominatim / Overpass),
  `get_weather` (Open-Meteo), `present_itinerary`.
- **Auth:** Supabase Auth (Google), cookie sessions, RLS-scoped data.
- **Reminders:** a daily Vercel Cron job + a Telegram bot.

## Run the web app locally

See [`web/README.md`](web/README.md) for full setup. In short:

```bash
cd web
cp .env.local.example .env.local   # fill in OpenAI, Supabase, Telegram keys
npm install
npm run seed                       # load the 348-trail catalog into Supabase
npm run dev                        # http://localhost:3000
```

Database setup: run the SQL files in [`supabase/`](supabase/) (schema, auth/RLS,
reminders, telegram-link) in the Supabase SQL editor.

## The Python prototype (removed)

TrailMate started as a Python CLI/Streamlit agent. Its ideas now live in the
web app — token-budgeted context compaction ([`web/server/agent/context.ts`](web/server/agent/context.ts)),
the skills pattern ([`web/server/agent/skills/`](web/server/agent/skills/)), and
Zod-validated tools ([`web/server/agent/tools.schemas.ts`](web/server/agent/tools.schemas.ts)) —
so the prototype was deleted — along with the Python scrapers that built the
trail catalog (their output, `.agents/data/trails_seed.json`, is committed, so
seeding needs no Python). Everything is in git history; the design rationale is
kept in [`docs/architecture.md`](docs/architecture.md). The repo is now 100% TypeScript.

## License

TBD
