# TrailMate Web (Next.js → Vercel)

TypeScript rewrite of the TrailMate agent: a Next.js App Router app with a
streaming chat agent (OpenAI gpt-4o), a tiuli-backed trail catalog in Supabase,
and a live trip notebook. Deploys to Vercel.

## Architecture

- `app/page.tsx` — two-pane UI (chat + notebook), client components.
- `app/api/chat/route.ts` — streams the agent loop as NDJSON.
- `app/api/trip/[id]/route.ts` — loads a saved itinerary (shareable by id).
- `lib/agent.ts` — bounded OpenAI tool-calling loop (ported from the Python AIService).
- `lib/tools/*` — typed tools: `search_tiuli` (Supabase catalog), `search_trails`
  (Israel Hiking Map/OSM), `search_places` (Nominatim/Overpass), `get_weather`
  (Open-Meteo), `save_trip` (Supabase).
- `lib/supabase.ts` — server-only Supabase client (service_role key).

## Setup

### 1. Supabase
1. Create a project at https://supabase.com (free tier).
2. SQL editor → run `../supabase/schema.sql` (creates `trails` + `trips`).
3. Project Settings → API → copy the **Project URL** and the **service_role** key.

### 2. Env
```bash
cp .env.local.example .env.local
# fill in OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

### 3. Install + seed the trail catalog
```bash
npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed   # loads 348 trails
```

### 4. Run
```bash
npm run dev    # http://localhost:3000
```

## Deploy to Vercel
1. Push this repo; in Vercel, import it and set **Root Directory = `web`**.
2. Add env vars: `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Deploy. (Heavy multi-tool trips may need Vercel Pro / Fluid Compute to exceed
   the 60s function cap — see `maxDuration` in `app/api/chat/route.ts`.)
