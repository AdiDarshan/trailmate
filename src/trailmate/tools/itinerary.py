"""Itinerary persistence tool — saves structured trip data for the notebook UI."""

from __future__ import annotations

import json
from pathlib import Path

# Written to project root so the UI can read it regardless of cwd.
_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
ITINERARY_PATH = _PROJECT_ROOT / ".trailmate_current_trip.json"


def save_itinerary(args: dict) -> dict:
    """Persist a structured trip itinerary to disk for the notebook UI.

    Expected shape::

        {
          "title":  "2-Day Trip: Galilee",
          "dates":  "June 23–24, 2026",
          "days": [
            {
              "day_number": 1,
              "date":        "Monday, June 23",
              "weather":     "Partly cloudy, 28°C",
              "weather_note": "Start before 8am — very hot",
              "trail": {
                "name":        "Arbel Trail",
                "distance_km": "12",
                "duration":    "3–4h",
                "difficulty":  "Moderate",
                "start_maps":  "https://www.google.com/maps?q=...",
                "waze":        "https://waze.com/...",
                "tiuli_url":   "https://www.tiuli.com/tracks/...",
                "description": "Scenic cliffs above the Sea of Galilee..."
              },
              "lunch":  {"name": "...", "address": "...", "maps": "..."},
              "dinner": {"name": "...", "address": "...", "maps": "..."},
              "hotel":  {"name": "...", "address": "...", "maps": "..."}
            }
          ]
        }

    Returns the number of days saved on success.
    """
    try:
        days = args.get("days", [])
        ITINERARY_PATH.write_text(json.dumps(args, ensure_ascii=False, indent=2))
        return {"status": "success", "days_saved": len(days)}
    except Exception as e:
        return {"status": "error", "message": str(e)}
