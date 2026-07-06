# TrailMate

## What it does
TrailMate is an AI travel companion for hiking trips in Israel. You chat with it
in plain language ("plan 2 days in the Galilee next Saturday") and it builds a
concrete day-by-day itinerary — trail, meals, accommodation, and weather for each
day — rendered in a live notebook with Google Maps and Waze links. You sign in,
save trips to your own list, reopen and edit them, and get proactive Telegram
messages: a confirmation when you save, and a short "where to start / what to
bring / what to know" summary the day before each day of the trip.

## Architecture
A Next.js (App Router) app on **Vercel**, TypeScript end-to-end. The server is
layered — thin route handlers → controllers → services → db-services — grouped
into domain modules. An **agent** (OpenAI gpt-4o, bounded tool-calling loop,
streamed) orchestrates typed **tools**: `search_tiuli` (a curated 348-trail
catalog), `search_trails` (Israel Hiking Map / OpenStreetMap), `search_places`
(Nominatim / Overpass), `get_weather` (Open-Meteo), and `present_itinerary`.
Storage is **Supabase Postgres** (trails catalog, trips, account↔Telegram links).
The tiuli catalog was scraped once offline into Supabase rather than fetched live.
Auth is **Supabase Auth (Google)**. Proactive messaging runs via a daily **Vercel
Cron** job + a **Telegram bot** webhook.

## Security
Secrets (OpenAI key, Supabase service-role key, Telegram token) live only in
server-side env vars, never shipped to the browser. User data is isolated by
**Postgres Row-Level Security**: user-facing reads/writes run as the signed-in
user's session, so the database itself blocks cross-user access (not just app
code) — this closed a real leak we found in testing. The cron endpoint is
protected by a shared secret; per-user API responses are `no-store`. The agent
only calls a fixed set of typed tools (no shell/arbitrary code execution), and
all trail/place/weather data comes from real public sources — no fabricated
recommendations. **Human-in-the-loop:** the agent only *presents* an itinerary;
nothing is saved until the user clicks Save, and Telegram reminders require an
explicit one-time opt-in.

## Goals
1. Turn a vague trip idea into a trustworthy, bookable day-by-day plan in one chat.
2. Keep users' trips private and persistent across devices (real accounts).
3. Stay useful between sessions via timely, proactive reminders — not just at plan time.

## Customers
Hikers and weekend travelers in Israel (locals and tourists) who want a real,
specific itinerary fast — without stitching together trail sites, maps,
restaurant search, and weather themselves. They choose TrailMate because it uses
real Israeli trail/place data, speaks both Hebrew and English place names, and
follows up proactively the day before each hike.
