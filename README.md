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
| [`src/trailmate/`](src/trailmate/) | The original **Python prototype** (Streamlit UI + agent). Kept for reference; superseded by `web/`. |
| [`supabase/`](supabase/) | SQL migrations for the Supabase database. |
| [`.agents/`](.agents/) | Skill definitions + the tiuli trail dataset used to seed Supabase. |
| [`scripts/`](scripts/) | One-off tooling (e.g. the tiuli catalog enrichment crawler). |

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

## The Python prototype

The original CLI/Streamlit version still runs:

```bash
pip install -e ".[dev]"
python -m trailmate                       # CLI
streamlit run src/trailmate/ui/app.py     # UI
pytest                                     # tests
```

## License

TBD
