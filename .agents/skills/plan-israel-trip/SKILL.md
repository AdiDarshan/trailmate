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

## Step: Enrich each trail with tiuli.com data

After the pipeline returns, enrich **every trail** in the itinerary with data from tiuli.com before presenting. Do this for each `morning_trail` in the schedule:

1. **Search** for the tiuli page:
   ```
   WebSearch: site:tiuli.com/tracks <trail name>
   ```
   Take the first result matching `tiuli.com/tracks/<id>/<slug>`. If no result, skip enrichment for that trail.

2. **Fetch** the tiuli data:
   ```bash
   python .agents/skills/fetch-tiuli-trail/scripts/get_tiuli_trail.py "https://www.tiuli.com/tracks/<id>/<slug>"
   ```

3. **Merge** into the trail card — tiuli fields take precedence over OSM fields when both are present:
   - `waze_link` → always show as 🧭 Waze navigation link
   - `description_he` → show as the main trail description
   - `difficulty_he` → replaces OSM difficulty label
   - `duration_he` → supplements `estimated_duration`
   - `trail_map_image` → show as 🗺️ trail map link
   - `tiuli_url` → show as 🔗 link for more details

If `get_tiuli_trail.py` returns `{"error": ...}`, skip silently and show only OSM data.

## Presenting the itinerary

```
# 🇮🇱 [N]-Day Trip: [Area]
📅 [dates] | ☁️ [weather summary or "no forecast — dates not specified"]
🏨 Base: [📍 hotel name](https://www.google.com/maps?q=LAT,LNG)

## Day 1 — [date] | [condition] [emoji]
> [weather_note if present]

🌅 Morning — **[trail name]**
   🧭 [ניווט ל-Waze](waze_link)
   📍 Trailhead: [📍 Start here](https://www.google.com/maps?q=trailhead_lat,trailhead_lng)
   🗺️ [from] → [to]  |  📏 [distance_km] km  |  ⏱️ [duration_he or estimated_duration]  |  💪 [difficulty_he or difficulty]
   🚗 Cars: [car_logistics]  |  📈 ↑[elevation_gain_m] m ↓[elevation_loss_m] m
   📝 [description_he]
   🗺️ [מפת המסלול](trail_map_image)
   🔗 [פרטים נוספים באתר טיולי](tiuli_url)

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
