---
name: fetch-tiuli-trail
description: >
  Use this skill AFTER search-israel-trails returns a trail name, to enrich
  the result with Hebrew-facing data from tiuli.com: a Waze navigation link,
  Hebrew description written by editors, difficulty label in Hebrew, and
  estimated duration. Always call this as a second step when the user will
  actually visit the trail — the Waze link is essential for getting there.
---

# Fetch Trail Details from tiuli.com

Enriches trail data with navigation and editorial content from tiuli.com,
Israel's leading Hebrew hiking portal.

## Bundled resources

| Path | Purpose |
|---|---|
| `scripts/get_tiuli_trail.py` | Fetches a tiuli.com trail URL and returns structured JSON |

## Procedure

### Step 1 — Find the tiuli.com URL via WebSearch

Use the `WebSearch` tool (available to the agent) to find the tiuli page:

```
query: site:tiuli.com/tracks <trail name from IHM>
```

Example: `site:tiuli.com/tracks נחל ערוגות`

Take the first result URL that matches the pattern `tiuli.com/tracks/<id>/<slug>`.
If no result is found, skip tiuli enrichment and present only IHM data.

### Step 2 — Fetch and parse the tiuli page

Pass the URL to the script via `run_script`:

```bash
python .agents/skills/fetch-tiuli-trail/scripts/get_tiuli_trail.py "https://www.tiuli.com/tracks/<id>/<slug>"
```

### Step 3 — Merge into the trail card

On success, add these fields to the trail card already built from IHM data:

| tiuli field | Where to show it |
|---|---|
| `waze_link` | 🧭 **ניווט ל-Waze** — always show as a clickable link |
| `description_he` | 📝 תיאור — show as the main trail description |
| `difficulty_he` | 💪 קושי (replaces OSM difficulty when present) |
| `duration_he` | ⏱️ משך (supplement OSM estimated_duration) |
| `trail_map_image` | 🗺️ [מפת המסלול](url) |
| `tiuli_url` | 🔗 [פרטים נוספים באתר טיולי](url) |

On failure (`"error"` key present), skip silently and present only IHM data.

### Full trail card format (IHM + tiuli combined)

```
🥾 **[name_he or name]**
   🧭 [ניווט ל-Waze](waze_link)
   📍 נקודת התחלה: [📍 פתח במפות](https://www.google.com/maps?q=LAT,LNG)
   📏 מרחק: [distance_km] ק"מ
   ⏱️ משך: [duration_he or estimated_duration]
   💪 קושי: [difficulty_he or difficulty]
   📈 עלייה: ↑[elevation_gain_m] מ'  ירידה: ↓[elevation_loss_m] מ'
   🚗 רכבים: [car_logistics]
   📝 [description_he]
   🗺️ [מפת המסלול](trail_map_image)
   🔗 [פרטים נוספים באתר טיולי](tiuli_url)
```

## Audit tests
should-trigger:     After IHM returns a trail name — always try tiuli enrichment
should-NOT-trigger: Standalone use without a trail name from IHM
