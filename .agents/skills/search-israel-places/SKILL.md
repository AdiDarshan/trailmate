---
name: search-israel-places
description: >
  Use this skill whenever the TrailMate agent needs to find restaurants,
  hotels, accommodations, or points of interest (POIs) in Israel to build a
  travel itinerary. Trigger whenever the user mentions traveling in Israel and
  needs places to eat, sleep, or visit — even if they don't explicitly ask for
  "restaurants" or "hotels". This skill always runs alongside search-israel-trails
  to produce a complete day-by-day schedule.
---

# Search Israel Places

Real place data from OpenStreetMap via Nominatim + Overpass API.
No API key required — completely free.

## Bundled resources

| Path | Purpose |
|---|---|
| `scripts/search_places.py` | Runs the full search flow — always use this, never reimplement inline |
| `assets/places.schema.json` | JSON schema — validate every result against it |
| `references/api_spec.md` | API docs, tag reference, manual query guide |

## Procedure

1. **Run the script for each category needed** (restaurants, hotels, attractions):
   ```bash
   python scripts/search_places.py "<area>" --type restaurant|hotel|attraction [--max 5]
   ```
   - `<area>` should be specific: "Katzrin Golan Heights" not just "Israel"
   - Run restaurants, hotels, and attractions as separate calls

2. **Validate output** against `assets/places.schema.json`.
   Drop any fields not in the schema. Never fabricate missing data.

3. **If a call fails** (timeout, no results), fall back to Claude's knowledge for well-known spots in that area — note clearly that results may be outdated.

4. **Present places** in this format (only include fields present):
   ```
   🍽️ / 🏨 / 📍 [name]
      [cuisine if restaurant]
      [description if present]
      Address: [address]
      Hours: [opening_hours]
      Phone: [phone]
      [website]
      [osm_url]
   ```

5. **Combine with trail results** from `search-israel-trails` to build the full itinerary:
   - Morning: trail
   - Midday: restaurant near the trail area
   - Evening: restaurant / hotel in main town

## Day structure for a multi-day itinerary
For each day:
- 1 trail (from search-israel-trails)
- 1–2 restaurant recommendations (lunch near trail, dinner in town)
- 1 hotel recommendation (only once, for the area base)
- 1–2 attractions or POIs (from search-israel-places --type attraction)

## When to read references/api_spec.md
- Script fails and you need to debug or query Overpass manually
- You need to understand OSM tag structure for a specific place type

## Audit tests
should-trigger:     "Plan 3 days in the Golan, include places to eat and sleep"
should-NOT-trigger: "Find hiking trails near the Sea of Galilee"
