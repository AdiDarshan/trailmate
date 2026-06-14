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
   python scripts/search_trails.py "<query>" [--max 3] [--language en]
   ```
   The script handles all three API calls and returns a JSON array of trail objects.

2. **Validate output** against `assets/trail.schema.json`.
   - Fields not in the schema must be dropped.
   - Missing optional fields should be omitted — never fabricated or shown as "N/A".

3. **If a step fails** (Overpass timeout, no geometry), the script returns whatever
   it could collect. Present partial results — name and location are always enough
   to be useful.

4. **Present results** using this format per trail (only include fields present):
   ```
   🥾 [name]
      Area: [display_name]
      Color marking: [trail_color]
      Network: [local / regional / national]
      Distance: [distance_km] km
      Elevation gain: [elevation_gain_m] m
      Difficulty: [easy / moderate / hard]
      Ref: [ref]
      [description if present]
      Location: [lat, lng]
   ```

5. **After results**, offer to:
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
