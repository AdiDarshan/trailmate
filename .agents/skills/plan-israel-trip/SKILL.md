---
name: plan-israel-trip
description: >
  Use this skill whenever the user wants to plan, organize, or prepare a trip
  anywhere in Israel — even casually ("I want 3 days in the Golan", "plan a
  weekend in Eilat"). Always produce a concrete itinerary with specific dates.
  If the user did not provide dates, pick reasonable ones (e.g. starting next
  weekend) and state your assumption. If the user provided dates — specific
  ("July 15–18") or general ("in June", "next summer") — resolve them to a
  concrete YYYY-MM-DD start date before running the pipeline, then pass
  --start-date so the itinerary is weather-aware.
---

# Plan Israel Trip — Workflow Engine

Orchestrates four skills through a deterministic `WorkflowEngine`:
- 🥾 **fetch_trails** — hiking routes with distance, difficulty, coordinates
- 🍽️ **fetch_places_restaurant** — restaurants near the area
- 🏨 **fetch_places_hotel** — accommodation
- 📍 **fetch_places_attraction** — POIs and attractions
- ☁️ **fetch_weather** — forecast or historical proxy (skipped when no dates)
- 🗓️ **assemble_itinerary** — combines everything, applies weather adjustments

All free. No API keys required.

## Bundled scripts

| Path | Purpose |
|---|---|
| `scripts/run_pipeline.py` | Main entry point — always call this |
| `scripts/workflow_engine.py` | Engine internals |
| `scripts/get_weather.py` | Fetches forecast or historical proxy from Open-Meteo |

## Two-path procedure

### Path A — No dates given

User: "Plan a 3-day trip to the Negev"

1. Pick a concrete start date (e.g. next Saturday) and tell the user.
2. Run **without** `--start-date` — weather is skipped, itinerary uses trails/places only:
   ```bash
   python .agents/skills/plan-israel-trip/scripts/run_pipeline.py "Negev" --days 3
   ```
3. Present the itinerary. Offer to add weather if the user confirms dates.

### Path B — Dates given (specific or general)

User: "Plan 4 days in the Galilee in June" or "I want to go July 15–18"

1. **Resolve the date** to a concrete YYYY-MM-DD start date:
   - Specific ("July 15") → `2025-07-15`
   - General month ("in June") → use the 15th of that month in the nearest future year: `2025-06-15`
   - Relative ("next summer") → mid-July of the coming summer: `2025-07-15`
   - State your assumption to the user if you inferred the date.

2. Run **with** `--start-date`:
   ```bash
   python .agents/skills/plan-israel-trip/scripts/run_pipeline.py "Galilee" --days 4 --start-date 2025-06-15
   ```

3. The pipeline fetches weather for those exact dates:
   - Within 16 days → live forecast
   - Beyond 16 days → historical proxy (same calendar period last year). The output includes `"historical": true` — tell the user: *"Weather is based on historical data for that time of year, not a live forecast."*

4. The itinerary already has weather adjustments baked in (rainy days swap trail for indoor, hot days add early-start warning). Present the `weather_note` field for each day prominently.

## Presenting the itinerary

```
# 🇮🇱 [N]-Day Trip: [Area]
📅 [dates] | ☁️ [weather summary or "no forecast — dates not specified"]
🏨 Base: [📍 hotel name](https://www.google.com/maps?q=LAT,LNG)

## Day 1 — [date] | [condition] [emoji]
> [weather_note if present]

🌅 Morning — **[trail name]**
   📍 Trailhead: [📍 Start here](https://www.google.com/maps?q=trailhead_lat,trailhead_lng)
   🗺️ [from] → [to]  |  📏 [distance_km] km  |  ⏱️ [estimated_duration]  |  💪 [difficulty]
   🚗 Cars: [car_logistics]  |  📈 ↑[elevation_gain_m] m ↓[elevation_loss_m] m

🍽️ Lunch — [restaurant name]
🌙 Dinner — [restaurant name]
📍 Afternoon — [attraction name]
```

Every location must be a Google Maps link: [📍 Name](https://www.google.com/maps?q=LAT,LNG). Never show raw coordinates.

## On pipeline failure

If `status` is `failed`: check `history` for which step failed.
Trails failing is most common — try a broader area name.

## Audit tests
should-trigger:     "I want to spend 4 days in the Negev, suggest a route"
should-trigger:     "plan a family weekend in the Galilee in August"
should-trigger:     "3 days in Eilat next month"
should-NOT-trigger: "What's the weather like in Tel Aviv?" (weather only)
should-NOT-trigger: "Find me a hiking trail in the Carmel" (trail search only)
