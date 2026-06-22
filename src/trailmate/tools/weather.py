"""Weather tool — fetches forecasts via the plan-israel-trip skill script."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
_WEATHER_SCRIPT = (
    _PROJECT_ROOT / ".agents" / "skills" / "plan-israel-trip" / "scripts" / "get_weather.py"
)


def get_weather(args: dict) -> dict:
    """Call get_weather.py and return its parsed JSON output.

    Delegates entirely to the skill script — no weather logic lives here.
    The script handles geocoding, forecast vs. historical proxy selection,
    and field normalisation.
    """
    location = args.get("location", "").strip()
    if not location:
        return {"status": "error", "message": "location is required"}

    cmd = [sys.executable, str(_WEATHER_SCRIPT), location]

    date = args.get("date", "").strip()
    if date:
        cmd += ["--start-date", date]

    days = args.get("days", 3)
    cmd += ["--days", str(max(1, min(16, int(days))))]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=30, cwd=str(_PROJECT_ROOT)
        )
        data = json.loads(result.stdout)
        if result.returncode != 0:
            return {"status": "error", "message": data.get("error", result.stderr)}
        data["status"] = "success"
        return data
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Weather script timed out"}
    except (json.JSONDecodeError, Exception) as e:
        return {"status": "error", "message": str(e)}
