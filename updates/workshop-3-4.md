# TrailMate — Workshop 3–4 Update

**TrailMate** — an AI travel companion that takes your destination, dates, and preferences — and helps you plan trips with real data, day-by-day itineraries, and hiking trail recommendations.

🌐 **Now live:** https://trailmate-theta.vercel.app

## What it does

- Chats with you to plan a trip in plain language ("plan 2 days in the Galilee next Saturday") and builds a concrete **day-by-day itinerary** — trail, meals, accommodation, and weather per day
- Finds real hiking trails in Israel with distance, elevation, and difficulty
- Checks live weather at any destination
- **Sign in, save your trips, reopen and edit them** — your trips are private to you
- **Proactive Telegram reminders** — a confirmation when you save, and a "where to start / what to bring / what to know" summary the day before each day
- Every place is a tappable Google Maps / Waze link

## What I've built so far (Workshop 3–4): from prototype → deployed product

The Python harness from Workshop 1–2 became a real **Next.js (App Router) app on Vercel**, TypeScript end-to-end.

- 🤖 **Agent** — OpenAI `gpt-4o` in a bounded tool-calling loop, token-streamed to a thin React client. It only *presents* an itinerary; nothing is saved until you click Save (human-in-the-loop).
- 🧰 **Tools (typed, no shell/arbitrary code)** — `search_tiuli` (a curated **348-trail** catalog scraped from tiuli.com into Supabase), `search_trails` (Israel Hiking Map / OpenStreetMap), `search_places` (Nominatim / Overpass for restaurants & hotels), `get_weather` (Open-Meteo), and `present_itinerary`.
- 🗄️ **Storage** — **Supabase Postgres** (trails catalog, trips, account↔Telegram links). Server is layered: route handlers → controllers → services → db-services, grouped by domain.
- 🔐 **Auth & isolation** — **Supabase Auth (Google)**; user data isolated by **Postgres Row-Level Security**, so the database itself blocks cross-user access (this closed a real leak we caught in testing). Secrets stay server-side; per-user responses are `no-store`.
- 📲 **Proactive messaging** — a daily **Vercel Cron** job + a **Telegram bot** webhook, gated behind an explicit one-time opt-in.

**A lot more is coming.**
