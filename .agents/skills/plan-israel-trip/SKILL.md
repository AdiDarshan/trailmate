---
name: plan-israel-trip
description: >
  Use this skill whenever a user asks to plan, organize, or prepare a trip,
  travel, or visit anywhere in Israel — even if they just say "I want to travel
  3 days in the Golan" or "plan a weekend in Eilat". This is the main
  orchestration workflow: it runs a deterministic pipeline combining trail search,
  place search (restaurants, hotels, attractions), live weather forecast, and
  precise GPS coordinates into a complete day-by-day itinerary. Always trigger
  this skill for any Israel travel planning request, even partial or casual ones.
---

# Plan Israel Trip — Workflow Engine

Orchestrates four skills through a deterministic `WorkflowEngine`:
- 🥾 **fetch_trails** — hiking routes with distance, difficulty, coordinates
- 🍽️ **fetch_places_restaurant** — restaurants near the area
- 🏨 **fetch_places_hotel** — accommodation
- 📍 **fetch_places_attraction** — POIs and attractions
- ☁️ **fetch_weather** — live 7-day forecast (Open-Meteo, free)
- 🗓️ **assemble_itinerary** — combines everything with weather adjustments

All free. No API keys required.

## Bundled scripts

| Path | Purpose |
|---|---|
| `scripts/run_pipeline.py` | `/run-pipeline` command — always call this, never orchestrate inline |
| `scripts/workflow_engine.py` | Engine: `WorkflowStatus`, `ContextState`, `WorkflowEngine`, `BaseAgentSkill` |
| `scripts/get_weather.py` | Fetches forecast from Open-Meteo |

## How to invoke

```bash
python scripts/run_pipeline.py "<area>" --days <N> [--dry-run] [--log run.jsonl]
```

**Examples:**
```bash
python scripts/run_pipeline.py "Golan Heights" --days 3
python scripts/run_pipeline.py "Eilat" --days 2 --dry-run
python scripts/run_pipeline.py "Jerusalem area" --days 4 --log /tmp/trailmate.jsonl
```

Always pass the user's stated area and days directly. Do not pre-process them.

## Guardrails built into the pipeline

- **Input validation**: rejects empty areas and days outside 1–14 before calling any API
- **Israel check**: soft-warns if the area doesn't look Israeli (doesn't block)
- **Verifier on every step**: each skill has a `verify()` that checks schema and required fields
- **Non-fatal steps**: places and weather failures don't abort — the itinerary is assembled with whatever data is available
- **Fatal steps**: trails must succeed (no trails = no trip to plan); assemble must succeed
- **Every action is logged**: `execution_history` in the state captures every step with timestamp, inputs, ok/fail, elapsed time
- **Irreversible steps**: any `BaseAgentSkill` with `irreversible=True` is gated behind `dry_run` or human OK — the engine pauses at `AWAITING_VERIFICATION` status

## Output structure

```json
{
  "status": "completed",
  "session_id": "...",
  "itinerary": {
    "area": "Golan Heights",
    "days": 3,
    "weather_location": "רמת הגולן, ישראל",
    "base_hotel": { "name": "...", "location": {...}, ... },
    "schedule": [
      {
        "day": 1,
        "date": "2026-06-14",
        "weather": { "condition": "Overcast", "temp_max_c": 27.2, "advice": [...] },
        "weather_note": null,
        "morning_trail": { "name": "...", "distance_km": ..., "location": {...}, ... },
        "lunch": { "name": "...", "location": {...}, ... },
        "attraction": { "name": "...", "location": {...}, ... },
        "dinner": { "name": "...", "location": {...}, ... }
      }
    ]
  },
  "steps_run": 12
}
```

## Presenting the itinerary to the user

After running the pipeline, render each day like this:

```
# 🇮🇱 [N]-Day Trip: [Area]
📅 [dates] | ☁️ [weather summary]
🏨 Base: [hotel name] — 📌 [lat, lng]

## Day 1 — [date] | [condition] [emoji]
> [weather_note if present]

🌅 Morning — [trail name]
   [distance] km | [difficulty] | 📌 [lat, lng]

🍽️ Lunch — [restaurant name]
   [cuisine] | 📌 [lat, lng] | [hours]

📍 Afternoon — [attraction name]
   📌 [lat, lng]

🌙 Dinner — [restaurant name]
   📌 [lat, lng]
```

Every location must show `📌 lat, lng`. Never omit coordinates.

## On pipeline failure

If `status` is `failed`:
1. Check `history` for which step failed and the `reason`
2. Trails failing is the most common — try a broader area name (e.g. "Golan" instead of "northern Golan")
3. Report clearly: "I couldn't find trails for [area] — try rephrasing (e.g. 'Katzrin area')"

## Execution graph (for reference)

```
fetch_trails → fetch_places_restaurant → fetch_places_hotel
             → fetch_places_attraction → fetch_weather → assemble_itinerary
```

## Audit tests
should-trigger:     "I want to spend 4 days in the Negev, suggest a route"
should-trigger:     "plan a family weekend in the Galilee"
should-NOT-trigger: "What's the weather like in Tel Aviv?" (weather only)
should-NOT-trigger: "Find me a hiking trail in the Carmel" (trail only)
