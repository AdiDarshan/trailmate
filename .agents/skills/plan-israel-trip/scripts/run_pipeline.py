#!/usr/bin/env python3
"""TrailMate trip planning pipeline — /run-pipeline command.

Usage:
    python run_pipeline.py "<area>" --days N [--dry-run] [--log path/to/log.jsonl]

Examples:
    python run_pipeline.py "Golan Heights" --days 3
    python run_pipeline.py "Eilat" --days 2 --dry-run

Exits 0 and prints JSON itinerary data on success.
Exits 1 on failure, with {"error": ..., "history": [...]} for debugging.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

# Import engine from same directory
sys.path.insert(0, str(Path(__file__).parent))
from workflow_engine import BaseAgentSkill, ContextState, WorkflowEngine, WorkflowStatus

SCRIPTS_DIR = Path(__file__).parent
TRAILS_SCRIPT = SCRIPTS_DIR / "../../search-israel-trails/scripts/search_trails.py"
PLACES_SCRIPT = SCRIPTS_DIR / "../../search-israel-places/scripts/search_places.py"
WEATHER_SCRIPT = SCRIPTS_DIR / "get_weather.py"


# ── Guardrails ─────────────────────────────────────────────────────────────────

def validate_inputs(area: str, days: int) -> tuple[bool, str]:
    """Guardrail: reject obviously bad inputs before running anything."""
    if not area or len(area.strip()) < 2:
        return False, "Area name is too short or empty"
    if days < 1 or days > 14:
        return False, f"Days must be between 1 and 14 (got {days})"
    israel_keywords = [
        "israel", "golan", "negev", "galilee", "jerusalem", "tel aviv",
        "eilat", "haifa", "dead sea", "galil", "hermon", "carmel",
        "judea", "samaria", "arava", "kineret", "kinneret",
    ]
    if not any(kw in area.lower() for kw in israel_keywords):
        # Soft warning — don't block, but flag it
        print(f"[GUARDRAIL] Warning: '{area}' may not be in Israel — proceeding anyway", file=sys.stderr)
    return True, "ok"


# ── Skill implementations ──────────────────────────────────────────────────────

def _run_script(script: Path, args: list[str], timeout: int = 120) -> dict[str, Any]:
    """Run a Python script and return parsed JSON output."""
    proc = subprocess.Popen(
        [sys.executable, str(script)] + args,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        stdout, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()  # guaranteed fast after SIGKILL; avoids the hanging communicate() in subprocess.run
        return {"ok": False, "error": f"Script timed out after {timeout}s", "data": None}
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return {"ok": False, "error": f"Script returned non-JSON: {stdout[:200]}", "data": None}
    if isinstance(data, dict) and "error" in data and len(data) == 1:
        return {"ok": False, "error": data["error"], "data": None}
    return {"ok": True, "data": data}


class TrailsSkill(BaseAgentSkill):
    name = "fetch_trails"

    def execute(self, inputs: dict) -> dict:
        area = inputs["area"]
        max_trails = inputs.get("max", 5)
        # IHM search returns hiking route relations when the query includes
        # "trail" — bare area names ("Galilee") return only place/wiki results.
        # Try "<area> trail" first; fall back to plain area name if empty.
        result = _run_script(TRAILS_SCRIPT, [f"{area} trail", "--max", str(max_trails)])
        if result.get("ok") and result.get("data"):
            return result
        return _run_script(TRAILS_SCRIPT, [area, "--max", str(max_trails)])

    def verify(self, result: dict) -> tuple[bool, str]:
        ok, reason = super().verify(result)
        if not ok:
            return False, reason
        trails = result["data"]
        if not isinstance(trails, list):
            return False, "Trails result is not a list"
        if len(trails) == 0:
            return False, "No trails found for this area"
        for t in trails:
            if "name" not in t:
                return False, "Trail missing required 'name' field"
        return True, f"Found {len(trails)} trails"


class PlacesSkill(BaseAgentSkill):
    name = "fetch_places"

    def execute(self, inputs: dict) -> dict:
        area = inputs["area"]
        place_type = inputs.get("type", "restaurant")
        max_places = inputs.get("max", 5)
        # Brief pause so Overpass rate limits from the preceding trails search don't bleed over
        time.sleep(2)
        return _run_script(PLACES_SCRIPT, [area, "--type", place_type, "--max", str(max_places)])

    def verify(self, result: dict) -> tuple[bool, str]:
        ok, reason = super().verify(result)
        if not ok:
            # Places are non-fatal — we can continue with empty results
            return True, f"Places unavailable ({reason}) — will use fallback"
        places = result["data"]
        if not isinstance(places, list):
            result["data"] = []
            return True, "Places result is not a list — using empty fallback"
        return True, f"Found {len(places)} places"


class WeatherSkill(BaseAgentSkill):
    name = "fetch_weather"

    def execute(self, inputs: dict) -> dict:
        start_date = inputs.get("start_date")
        if not start_date:
            # No dates requested — skip weather, assemble without forecast.
            return {"ok": True, "data": {}}
        area = inputs["area"]
        days = inputs.get("days", 3)
        return _run_script(WEATHER_SCRIPT, [area, "--days", str(days), "--start-date", start_date])

    def verify(self, result: dict) -> tuple[bool, str]:
        ok, reason = super().verify(result)
        if not ok:
            return True, f"Weather unavailable ({reason}) — proceeding without forecast"
        data = result["data"]
        if not data:
            return True, "No start date — weather skipped"
        if "forecast" not in data:
            return True, "Weather data missing forecast — proceeding without"
        historical = data.get("historical", False)
        label = "historical proxy" if historical else "live forecast"
        return True, f"Weather {label} for {len(data['forecast'])} days"


class AssembleSkill(BaseAgentSkill):
    name = "assemble_itinerary"

    def execute(self, inputs: dict) -> dict:
        ctx = inputs["context"]
        area = inputs["area"]
        days = inputs["days"]

        trails = ctx.get("fetch_trails") or []
        restaurants = ctx.get("fetch_places_restaurant") or []
        hotels = ctx.get("fetch_places_hotel") or []
        attractions = ctx.get("fetch_places_attraction") or []
        weather = ctx.get("fetch_weather") or {}

        forecast = weather.get("forecast", [{}] * days)

        itinerary = {
            "area": area,
            "days": days,
            "weather_location": weather.get("location"),
            "schedule": [],
            "base_hotel": hotels[0] if hotels else None,
        }

        for day_idx in range(days):
            day_weather = forecast[day_idx] if day_idx < len(forecast) else {}
            trail = trails[day_idx % len(trails)] if trails else None
            restaurant_lunch = restaurants[(day_idx * 2) % len(restaurants)] if restaurants else None
            restaurant_dinner = restaurants[(day_idx * 2 + 1) % len(restaurants)] if restaurants else None
            attraction = attractions[day_idx % len(attractions)] if attractions else None

            # Weather adjustment guardrail — only runs when forecast data exists
            weather_note = None
            if day_weather:
                if day_weather.get("rain_mm", 0) > 5:
                    weather_note = "Rain expected — consider an indoor alternative"
                    if attraction:
                        trail = None  # swap trail for attraction on rainy days
                elif day_weather.get("temp_max_c", 0) > 33:
                    weather_note = "Very hot — start hike early (before 08:00), carry 2L+ water"
                elif day_weather.get("wind_kmh", 0) > 40:
                    weather_note = "Strong winds — avoid exposed ridge trails"

            day = {
                "day": day_idx + 1,
                "date": day_weather.get("date"),
                "weather": {
                    "condition": day_weather.get("condition"),
                    "temp_max_c": day_weather.get("temp_max_c"),
                    "temp_min_c": day_weather.get("temp_min_c"),
                    "advice": day_weather.get("advice", []),
                },
                "weather_note": weather_note,
                "morning_trail": trail,
                "lunch": restaurant_lunch,
                "attraction": attraction,
                "dinner": restaurant_dinner,
            }
            itinerary["schedule"].append(day)

        return {"ok": True, "data": itinerary}

    def verify(self, result: dict) -> tuple[bool, str]:
        ok, reason = super().verify(result)
        if not ok:
            return False, reason
        schedule = result["data"].get("schedule", [])
        if len(schedule) == 0:
            return False, "Assembled itinerary has no days"
        return True, f"Itinerary assembled: {len(schedule)} days"


# ── Pipeline entry point ───────────────────────────────────────────────────────

def run(area: str, days: int, start_date: str | None = None,
        dry_run: bool = False, log_path: Path | None = None) -> dict:
    # Guardrail check before touching any APIs
    valid, reason = validate_inputs(area, days)
    if not valid:
        return {"error": f"Input validation failed: {reason}", "history": []}

    state = ContextState(session_id=str(uuid.uuid4()))
    engine = WorkflowEngine(state, log_path=log_path, dry_run=dry_run)

    # Register all skills
    engine.register_skill("fetch_trails", TrailsSkill())
    engine.register_skill("fetch_places_restaurant", PlacesSkill())
    engine.register_skill("fetch_places_hotel", PlacesSkill())
    engine.register_skill("fetch_places_attraction", PlacesSkill())
    engine.register_skill("fetch_weather", WeatherSkill())
    engine.register_skill("assemble_itinerary", AssembleSkill())

    # Execution graph: each step unlocks the next
    engine.set_execution_graph({
        "fetch_trails":             ["fetch_places_restaurant", "fetch_places_hotel", "fetch_places_attraction", "fetch_weather"],
        "fetch_places_restaurant":  ["fetch_places_hotel"],
        "fetch_places_hotel":       ["fetch_places_attraction"],
        "fetch_places_attraction":  ["fetch_weather"],
        "fetch_weather":            ["assemble_itinerary"],
        "assemble_itinerary":       [],
    })

    # Run the pipeline
    steps = [
        ("fetch_trails",            {"area": area, "max": days + 2}),
        ("fetch_places_restaurant", {"area": area, "type": "restaurant", "max": days * 2}),
        ("fetch_places_hotel",      {"area": area, "type": "hotel", "max": 3}),
        ("fetch_places_attraction", {"area": area, "type": "attraction", "max": days * 2}),
        ("fetch_weather",           {"area": area, "days": days, "start_date": start_date}),
        ("assemble_itinerary",      {"area": area, "days": days, "context": state.global_context}),
    ]

    final_state = engine.run_pipeline(steps)

    if final_state.status == WorkflowStatus.COMPLETED:
        return {
            "status": "completed",
            "session_id": final_state.session_id,
            "itinerary": final_state.get("assemble_itinerary"),
            "steps_run": len(final_state.execution_history),
        }
    else:
        return {
            "status": final_state.status.value,
            "session_id": final_state.session_id,
            "error": "Pipeline did not complete",
            "history": final_state.execution_history,
        }


# ── CLI ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"error": "Usage: run_pipeline.py <area> --days N [--dry-run] [--log path]"}))
        sys.exit(1)

    area = args[0]
    days = 3
    start_date = None
    dry_run = False
    log_path = None

    i = 1
    while i < len(args):
        if args[i] == "--days" and i + 1 < len(args):
            days = int(args[i + 1]); i += 2
        elif args[i] == "--start-date" and i + 1 < len(args):
            start_date = args[i + 1]; i += 2
        elif args[i] == "--dry-run":
            dry_run = True; i += 1
        elif args[i] == "--log" and i + 1 < len(args):
            log_path = Path(args[i + 1]); i += 2
        else:
            i += 1

    result = run(area, days, start_date=start_date, dry_run=dry_run, log_path=log_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("status") == "completed" else 1)
