---
name: plan-israel-trip
description: >
  Use this skill whenever the user wants to plan, organize, or prepare a trip
  anywhere in Israel — even casually ("I want 3 days in the Golan", "plan a
  weekend in Eilat", "where should I hike next week?"). Always produce a
  concrete, day-by-day itinerary. If dates are missing, pick reasonable ones
  (next Saturday) and tell the user what you assumed.
---

# Plan Israel Trip

## Before you run any script — confirm these inputs

| Input | How to resolve if missing |
|---|---|
| **Area** | Ask: "Which area of Israel?" |
| **Days** | Ask: "How many days?" |
| **Start date** | If not given, use next Saturday. Tell the user: "I'll plan starting [date] — let me know if you'd like a different date." |

Resolve a vague date like "next summer" → mid-July, "in June" → June 15 of the nearest future year.

---

## Mandatory workflow — follow ALL steps in order

### Step 1 — Search trails

```bash
python .agents/skills/search-israel-trails/scripts/search_trails.py "<area> trail" --max <days+2>
```

> **CRITICAL — query must end with " trail":**
> The word "hike" returns zero results. The IHM API only matches "trail". Always construct the query as `"<area> trail"` — never `"<area> hike"` or just `"<area>"`.
>
> **Tips:**
> - The script automatically drops routes over 30 km (regional / multi-day trails). A good day hike is 5–20 km.
> - If results come back empty (`[]`), try a more specific sub-area or trail name: `"Lower Galilee trail"`, `"Arbel trail"`, `"Nahal Amud trail"`, `"Kinneret trail"`.
> - If all returned trails are still `long_distance_route: true`, try the specific trail names above one by one until you get a day hike.
> - If all returned trails are still over 20 km, add `--max-km 20` to the command to tighten the filter.

Pick the best `<days>` trails from the results (one per day). Prefer variety in difficulty and location.

> **If a trail has `long_distance_route: true`:** the OSM geometry metrics are unreliable (inflated by summing all member ways). **Do not show distance or duration from this result.** Present the trail by name and location only — tiuli enrichment (Step 2) will supply the correct duration and description.

---

### Step 2 — Enrich EACH selected trail with tiuli.com data

For **every** trail you selected in Step 1, run:

```bash
python .agents/skills/fetch-tiuli-trail/scripts/get_tiuli_trail.py "<trail name>"
```

Use the exact `name` field returned from Step 1. The script matches against a local Hebrew index — no web search needed.

This returns:
- `waze_link` — navigation link to the trailhead (essential, always show this)
- `tiuli_url` — link where the user can read full hiking instructions
- `description_he` — editorial trail description (translate to English in your output)
- `difficulty_he`, `duration_he` — use these over OSM values when available
- `trail_map_image` — map image link

If the script returns `{"error": ...}`, skip silently and use OSM data only.

---

### Step 3 — Check weather

Use the `get_weather` **tool** (not a script):
- `location`: the area name
- `date`: trip start date (YYYY-MM-DD)
- `days`: number of trip days

**Hot weather rule — temp_max_c > 33°C on any day:**
Warn the user:
> ⚠️ [date] will be very hot ([X]°C). I recommend starting the hike before 08:00 and carrying 2L+ of water.

Also suggest a better time:
> For more comfortable hiking conditions, consider visiting in [October–April for most of Israel / avoid July–August in the Negev / the Galilee is more forgiving in spring].

Still present the itinerary — let the user decide whether to reschedule.

**If `historical: true`** in the response, note: "Weather is based on historical data for this time of year, not a live forecast."

---

### Step 4 — Find restaurants

```bash
python .agents/skills/search-israel-places/scripts/search_places.py "<area>" --type restaurant --max 4
```

Assign: 1 restaurant for lunch (near the trail), 1 for dinner (in the main town). If results are empty, suggest well-known options from your knowledge and note they may be outdated.

---

### Step 5 — Find accommodation

```bash
python .agents/skills/search-israel-places/scripts/search_places.py "<area>" --type hotel --max 2
```

Pick 1 hotel as the trip base. If no results, recommend the nearest large town's guesthouse or kibbutz accommodation.

---

### Step 6 — Save to notebook (MUST happen before the text response)

**Call `save_itinerary` as a tool call now, before writing the final text.**
The agent loop exits as soon as you return text — `save_itinerary` is a tool call and can only run in a tool-calling iteration, never after a text response. Always call it here.

Build the JSON from the data you already have:

```json
{
  "title": "2-Day Trip: Galilee",
  "dates": "June 23–24, 2026",
  "days": [
    {
      "day_number": 1,
      "date": "Monday, June 23",
      "weather": "Partly cloudy, 28°C",
      "weather_note": "Very hot — start before 08:00, carry 2L water",
      "trail": {
        "name": "Arbel Trail",
        "distance_km": "12",
        "duration": "3–4h",
        "difficulty": "Moderate",
        "start_maps": "https://www.google.com/maps?q=32.82,35.51",
        "waze": "https://waze.com/ul?...",
        "tiuli_url": "https://www.tiuli.com/tracks/...",
        "description": "Stunning cliffs above the Sea of Galilee..."
      },
      "dinner": { "name": "...", "address": "...", "maps": "https://www.google.com/maps?q=..." },
      "hotel":  { "name": "...", "address": "...", "maps": "https://www.google.com/maps?q=..." }
    }
  ]
}
```

Only include fields you actually have — omit rather than fabricate.

---

### Step 7 — Present the complete itinerary

After `save_itinerary` returns, write the itinerary **in English**. Use this exact structure:

```
# 🇮🇱 [N]-Day Trip: [Area]
📅 [start date] → [end date]
🏨 Base: [📍 Hotel Name](https://www.google.com/maps?q=LAT,LNG) — [address]

---

## Day [N] — [Weekday, Date] | [Weather condition + emoji]

> ⚠️ [weather_note — only if present]

**🥾 Trail: [Trail Name]**
- 🧭 Navigation: [Waze link text](waze_link)
- 📍 Start: [📍 Open in Maps](https://www.google.com/maps?q=LAT,LNG) — [trailhead_from description]
- 🏁 End: [trailhead_to description]
- 📏 [distance_km] km | ⏱️ [duration_he or estimated_duration] | 💪 [difficulty_he or difficulty]
- 📝 [description in English — translate from description_he if available]
- 🔗 Full hiking guide: [tiuli_url](tiuli_url)

**🍽️ Dinner:** [Restaurant Name] — [address] ([📍 Map](https://www.google.com/maps?q=LAT,LNG))

---
```

Rules:
- Every location that has coordinates → Google Maps link. Never show raw lat/lon.
- If a field is missing, omit it — never write "N/A".
- Output in English. Translate Hebrew descriptions if present.
- After the itinerary, offer: "Want me to export this as a PDF, adjust the dates, or swap any trail?"

---

## Audit tests
should-trigger:     "I want to spend 4 days in the Negev, suggest a route"
should-trigger:     "plan a family weekend in the Galilee in August"
should-trigger:     "3 days in Eilat next month"
should-NOT-trigger: "What's the weather like in Tel Aviv?" (weather only)
should-NOT-trigger: "Find me a hiking trail in the Carmel" (trail search only)
