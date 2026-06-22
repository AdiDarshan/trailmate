---
name: search-israel-trails
description: >
  Use this skill whenever the user asks about hiking trails in Israel — searching
  by name, area, or region (e.g. "trails near Carmel", "hike in Ein Gedi",
  "what trails are in the Galilee?"). Also trigger when the user is planning an
  Israeli trip and wants trail recommendations, or when they ask about difficulty,
  distance, or elevation of a specific Israeli trail. This skill runs a three-API
  enrichment flow (Israel Hiking Map → Overpass → elevation) to return real,
  structured trail data instead of guessing. Use it proactively any time Israeli
  hiking comes up — don't just answer from memory.
---

# Search Israeli Hiking Trails

Real trail data from OpenStreetMap via a three-API enrichment flow.
No API keys required.

## Bundled resources

| Path | Purpose |
|---|---|
| `scripts/search_trails.py` | Runs the full three-API flow — always use this, never reimplement inline |
| `assets/trail.schema.json` | JSON schema — validate every result against it |
| `references/api_spec.md` | Full API docs, field specs, color parsing rules, difficulty formula |

## Procedure

1. **Run the script:**
   ```bash
   python scripts/search_trails.py "<query>" [--max 3] [--language en] [--max-km 30]
   ```
   The script handles all three API calls, returns a JSON array of trail objects, and
   **automatically drops any trail over 30 km** (regional / multi-day routes).

   **Query tips:** IHM's search returns hiking route relations when the query includes "hike".
   Bare area names ("Galilee", "Carmel") return place/Wikipedia results — no trails.
   Always append "hike" to the area: `"Galilee hike"`, `"Carmel hike"`, `"Negev hike"`.
   For a specific named route use the full name: `"Arbel hike"`, `"Nahal Amud hike"`.
   A good day hike is 5–20 km. If a result has `long_distance_route: true`, the OSM distance
   and duration were stripped because they were unreliable (inflated geometry). Present the trail
   by name and location only, and rely on tiuli enrichment for actual duration and difficulty.

2. **Validate output** against `assets/trail.schema.json`.
   - Fields not in the schema must be dropped.
   - Missing optional fields should be omitted — never fabricated or shown as "N/A".

3. **If a step fails** (Overpass timeout, no geometry), the script returns whatever
   it could collect. Present partial results — name and location are always enough
   to be useful.

4. **Enrich with tiuli.com** — after getting IHM results, always call the tiuli enrichment
   script for each trail. Pass the Hebrew trail name (from `name` or `display_name`):
   ```bash
   python .agents/skills/fetch-tiuli-trail/scripts/get_tiuli_trail.py "<Hebrew trail name>"
   ```
   On success, merge these tiuli fields into the trail card:
   - `waze_link` → 🧭 ניווט ל-Waze (clickable link — essential for getting there)
   - `description_he` → replace the English OSM description
   - `difficulty_he` → replaces OSM difficulty label
   - `duration_he` → supplements `estimated_duration`
   - `trail_map_image` → 🗺️ מפת המסלול
   - `tiuli_url` → 🔗 פרטים נוספים באתר טיולי

   On failure (`"error"` key), skip silently and present only IHM data.

5. **Present results** using this format (include only fields that are present):
   ```
   🥾 **[name_he or name]**
      🧭 [ניווט ל-Waze](waze_link)
      📍 נקודת התחלה: [📍 פתח במפות](https://www.google.com/maps?q=LAT,LNG)
      🗺️ מ → עד: [trailhead_from] → [trailhead_to]
      📏 מרחק: [distance_km] ק"מ
      ⏱️ משך: [duration_he or estimated_duration]
      🚗 רכבים: [car_logistics]
      📈 עלייה: ↑[elevation_gain_m] מ'  ↓[elevation_loss_m] מ'
      💪 קושי: [difficulty_he or difficulty]
      🎨 סימון: [trail_color]
      📝 [description_he or description]
      🗺️ [מפת המסלול](trail_map_image)
      🔗 [פרטים נוספים באתר טיולי](tiuli_url)
   ```

   Always link the **trailhead coordinates** — not the general area center.

6. **After results**, offer to:
   - Check the weather at the trail location (`get_weather` tool if available)
   - Export to PDF
   - Build a day-trip itinerary around the trail

## When to read references/api_spec.md

Read it if:
- The script fails and you need to make API calls manually
- You need to debug color parsing or difficulty classification
- A user asks how the data is sourced

## Audit tests
should-trigger:     "What trails are near Jerusalem for a family hike?"
should-NOT-trigger: "Tell me about hiking in the Swiss Alps."
