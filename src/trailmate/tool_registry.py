"""Registry of tools the agent can call, plus their local executors.

Each tool entry is a pair of:
- `schema`: the dict format `chat.completions.create(tools=[...])` expects
- `exec`:   a plain Python callable that takes the parsed arguments dict
            and returns a JSON-serialisable result the model can read back.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
from pathlib import Path
from typing import Any, Callable
from xml.sax.saxutils import escape as xml_escape

import requests
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


class ToolRegistry:
    """Name → (OpenAI tool schema + local callable) registry.

    Construction registers the project's built-in tools via
    `_init_tools`. Callers may add more at runtime with `register`.
    """

    def __init__(self) -> None:
        # Underlying store. Each value is `{"schema": ..., "exec": ...}`.
        self.registry: dict[str, dict[str, Any]] = {}
        # Bootstrap built-in tools so a freshly-constructed registry is
        # immediately useful (the harness expects `export_pdf` to exist).
        self._init_tools()

    def register(
        self,
        name: str,
        description: str,
        parameters: dict,
        func: Callable[[dict], Any],
    ) -> None:
        """Add a tool, overwriting any existing entry with the same name.

        `parameters` must be a valid JSON Schema object describing the
        arguments the LLM will produce (see the OpenAI tool-calling
        docs). `func` receives the parsed arguments as a single dict.
        """
        self.registry[name] = {
            "schema": {
                "type": "function",
                "function": {
                    "name": name,
                    "description": description,
                    "parameters": parameters,
                },
            },
            "exec": func,
        }

    def get_tool_schemas(self) -> list[dict]:
        """Return every registered tool's schema in the order registered.

        This is the exact value to pass to `chat.completions.create` as
        `tools=...`.
        """
        return [item["schema"] for item in self.registry.values()]

    def execute(self, name: str, arguments_str: str | dict) -> Any:
        """Dispatch a tool call by name.

        OpenAI sends `tool_call.function.arguments` as a JSON-encoded
        string, so we parse it here. We also accept a pre-parsed dict
        for in-process callers (tests, the `__main__` smoke test) to
        avoid a pointless json round-trip.
        """
        if isinstance(arguments_str, str):
            args = json.loads(arguments_str)
        else:
            args = arguments_str
        return self.registry[name]["exec"](args)

    def _init_tools(self) -> None:
        """Register the project's built-in tools.

        Currently:
        - `export_pdf`    — write text to a PDF on local disk via ReportLab.
        - `get_weather`   — fetch current weather for a city via OpenWeatherMap.
        - `search_trails` — search Israeli hiking trails via Israel Hiking Map,
                            enriched with OSM tags (Overpass) and computed
                            distance + elevation gain (IHM elevation API).
        """
        self.register(
            name="export_pdf",
            description=(
                "Exports the given text content to a PDF file and saves it locally"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "description": "Output filename, e.g. report.pdf",
                    },
                    "content": {
                        "type": "string",
                        "description": "The text content to write into the PDF",
                    },
                },
                "required": ["filename", "content"],
            },
            func=_export_pdf,
        )
        self.register(
            name="get_weather",
            description=(
                "Fetches the current weather for a given city. "
                "Returns temperature (°C), feels-like temperature, humidity, "
                "wind speed, and a short condition description. "
                "Optionally accepts a two-letter country code to disambiguate "
                "cities with the same name (e.g. 'Toledo,ES' vs 'Toledo,US')."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": (
                            "City name, optionally with ISO 3166 country code, "
                            "e.g. 'Lisbon', 'Paris,FR', 'Springfield,US'."
                        ),
                    },
                    "units": {
                        "type": "string",
                        "enum": ["metric", "imperial"],
                        "description": (
                            "Unit system for temperature and wind speed. "
                            "'metric' → °C / m/s (default); 'imperial' → °F / mph."
                        ),
                    },
                },
                "required": ["city"],
            },
            func=_get_weather,
        )
        self.register(
            name="plan_trip",
            description=(
                "Plans a complete day-by-day trip itinerary anywhere in Israel. "
                "Runs a full pipeline: searches hiking trails, restaurants, hotels, "
                "attractions, and live weather forecast, then assembles them into a "
                "structured day-by-day schedule with GPS coordinates. "
                "Use whenever the user asks to plan a trip, visit, or travel anywhere "
                "in Israel — even casually ('I want 3 days in the Golan'). "
                "Prefer this over answering from memory."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "area": {
                        "type": "string",
                        "description": (
                            "The area or region in Israel, e.g. 'Golan Heights', "
                            "'Eilat', 'Galilee', 'Negev'."
                        ),
                    },
                    "days": {
                        "type": "integer",
                        "description": "Number of days for the trip (1–14). Defaults to 3.",
                    },
                },
                "required": ["area"],
            },
            func=_plan_trip,
        )
        self.register(
            name="search_trails",
            description=(
                "Searches for hiking trails in Israel by name or area. "
                "Returns trail name, location, color marking, network level, "
                "distance (km), elevation gain (m), and difficulty rating. "
                "Data is sourced from Israel Hiking Map (OpenStreetMap), "
                "enriched with OSM tags via Overpass, and computed geometry "
                "via the IHM routing and elevation APIs. No API key required."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Trail or area name to search for, e.g. "
                            "'Carmel', 'Israel National Trail', 'Ein Gedi'."
                        ),
                    },
                    "language": {
                        "type": "string",
                        "enum": ["en", "he"],
                        "description": "Language for trail names. Defaults to 'en'.",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of trails to return (1–5). Defaults to 3.",
                    },
                },
                "required": ["query"],
            },
            func=_search_trails,
        )


def _plan_trip(args: dict) -> dict:
    """Trigger the WorkflowEngine pipeline for full trip planning.

    Dynamically imports run_pipeline from the skills directory so the
    tool_registry has no hard import-time dependency on the pipeline.
    Returns the pipeline's JSON output directly — the LLM formats it for the user.
    """
    area = args.get("area", "").strip()
    days = int(args.get("days", 3))

    pipeline_path = (
        Path(__file__).parent.parent.parent
        / ".agents/skills/plan-israel-trip/scripts/run_pipeline.py"
    )

    try:
        spec = importlib.util.spec_from_file_location("run_pipeline", pipeline_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.run(area, days)
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _get_weather(args: dict) -> dict:
    """Fetch current weather from OpenWeatherMap's free /weather endpoint.

    Requires OPENWEATHERMAP_API_KEY in the environment (or a .env file
    loaded by the harness). Returns a flat dict the LLM can read back
    directly, or {"status": "error", "message": ...} on any failure.

    API docs: https://openweathermap.org/current
    """
    api_key = os.getenv("OPENWEATHERMAP_API_KEY")
    if not api_key:
        return {
            "status": "error",
            "message": (
                "OPENWEATHERMAP_API_KEY is not set. "
                "Add it to your .env file to use the weather tool."
            ),
        }

    city = args.get("city", "").strip()
    if not city:
        return {"status": "error", "message": "The 'city' argument is required."}

    units = args.get("units", "metric")

    try:
        response = requests.get(
            "https://api.openweathermap.org/data/2.5/weather",
            params={"q": city, "appid": api_key, "units": units},
            timeout=10,
        )

        if response.status_code == 401:
            return {"status": "error", "message": "Invalid OpenWeatherMap API key."}
        if response.status_code == 404:
            return {"status": "error", "message": f"City not found: '{city}'."}
        response.raise_for_status()

        data = response.json()
        unit_label = "°C" if units == "metric" else "°F"
        speed_label = "m/s" if units == "metric" else "mph"

        return {
            "status": "success",
            "city": data["name"],
            "country": data["sys"]["country"],
            "condition": data["weather"][0]["description"],
            "temperature": f"{data['main']['temp']}{unit_label}",
            "feels_like": f"{data['main']['feels_like']}{unit_label}",
            "humidity": f"{data['main']['humidity']}%",
            "wind_speed": f"{data['wind']['speed']} {speed_label}",
        }
    except requests.exceptions.Timeout:
        return {"status": "error", "message": "Weather API request timed out."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _search_trails(args: dict) -> dict:
    """Three-API flow for Israeli hiking trail search.

    Step 1 — Israel Hiking Map search:
        GET /api/search/{term}?language=en
        Returns POIs/trails; we keep only entries with icon "icon-hike".

    Step 2 — Overpass tag enrichment (OSM relations only):
        POST https://overpass-api.de/api/interpreter
        Query: [out:json];relation({id});out tags;
        Yields: trail color, network level, ref number, description.

    Step 3 — Geometry + elevation (when distance tag absent):
        POST Overpass for way geometry: relation({id});way(r);out geom;
        Compute distance via Haversine across all nodes.
        Sample up to 20 points, call IHM /api/elevation to get elevations.
        Sum positive deltas → elevation gain → difficulty label.

    Returns {"status": "success", "count": N, "trails": [...]}.
    Each trail dict contains whichever fields were available; missing
    fields are simply omitted rather than returned as None.
    """
    query = args.get("query", "").strip()
    language = args.get("language", "en")
    max_results = min(int(args.get("max_results", 3)), 5)

    if not query:
        return {"status": "error", "message": "The 'query' argument is required."}

    # ── Step 1: Israel Hiking Map search ────────────────────────────────────
    try:
        search_resp = requests.get(
            f"https://israelhiking.osm.org.il/api/search/{requests.utils.quote(query)}",
            params={"language": language},
            timeout=10,
        )
        search_resp.raise_for_status()
        results = search_resp.json()
    except Exception as e:
        return {"status": "error", "message": f"Trail search failed: {e}"}

    # Keep only hiking trails (icon-hike), cap at max_results.
    trails = [r for r in results if "hike" in r.get("icon", "")][:max_results]

    if not trails:
        return {
            "status": "success",
            "count": 0,
            "trails": [],
            "message": f"No hiking trails found for '{query}'.",
        }

    enriched = []
    for trail in trails:
        info: dict[str, Any] = {
            "name": trail.get("title"),
            "display_name": trail.get("displayName"),
            "location": trail.get("location"),
        }

        osm_id = trail.get("id", "")

        if osm_id.startswith("relation_"):
            rel_id = osm_id.replace("relation_", "")

            # ── Step 2: Overpass tag enrichment ─────────────────────────────
            try:
                tag_resp = requests.post(
                    "https://overpass-api.de/api/interpreter",
                    data=f"[out:json];relation({rel_id});out tags;",
                    timeout=15,
                )
                tag_resp.raise_for_status()
                elements = tag_resp.json().get("elements", [])
                if elements:
                    tags = elements[0].get("tags", {})
                    color = _parse_trail_color(tags.get("osmc:symbol", ""))
                    if color:
                        info["trail_color"] = color
                    network_map = {"lwn": "local", "rwn": "regional", "nwn": "national"}
                    if tags.get("network"):
                        info["network"] = network_map.get(tags["network"], tags["network"])
                    if tags.get("ref"):
                        info["ref"] = tags["ref"]
                    if tags.get("description"):
                        info["description"] = tags["description"]
                    if tags.get("distance"):
                        # OSM distance tags are sometimes "12 km" or just "12"
                        raw = tags["distance"].replace("km", "").strip()
                        try:
                            info["distance_km"] = float(raw)
                        except ValueError:
                            pass
            except Exception:
                pass  # Tag enrichment is best-effort; continue without it.

            # ── Step 3: Geometry → distance + elevation gain ─────────────────
            # Only run if we still don't have a distance from OSM tags.
            if "distance_km" not in info:
                try:
                    geom_resp = requests.post(
                        "https://overpass-api.de/api/interpreter",
                        data=f"[out:json];relation({rel_id});way(r);out geom;",
                        timeout=20,
                    )
                    geom_resp.raise_for_status()
                    ways = geom_resp.json().get("elements", [])

                    # Collect every node coordinate across all ways.
                    all_coords: list[tuple[float, float]] = []
                    for way in ways:
                        for node in way.get("geometry", []):
                            all_coords.append((node["lat"], node["lon"]))

                    if len(all_coords) >= 2:
                        # Total trail length via Haversine.
                        total_m = sum(
                            _haversine(all_coords[i], all_coords[i + 1])
                            for i in range(len(all_coords) - 1)
                        )
                        info["distance_km"] = round(total_m / 1000, 1)

                        # Sample up to 20 evenly-spaced points for elevation.
                        step = max(1, len(all_coords) // 20)
                        sample = all_coords[::step][:20]
                        points_param = "|".join(f"{lat},{lon}" for lat, lon in sample)

                        elev_resp = requests.get(
                            "https://israelhiking.osm.org.il/api/elevation",
                            params={"points": points_param},
                            timeout=10,
                        )
                        elev_resp.raise_for_status()
                        elevations: list[float] = elev_resp.json()

                        if len(elevations) >= 2:
                            gain = sum(
                                max(0.0, elevations[i + 1] - elevations[i])
                                for i in range(len(elevations) - 1)
                            )
                            info["elevation_gain_m"] = round(gain)
                            info["difficulty"] = _classify_difficulty(
                                info["distance_km"], gain
                            )
                except Exception:
                    pass  # Geometry enrichment is best-effort.

        enriched.append(info)

    return {"status": "success", "count": len(enriched), "trails": enriched}


# ── Trail helper functions ───────────────────────────────────────────────────

def _parse_trail_color(osmc_symbol: str) -> str:
    """Extract a human-readable color from an osmc:symbol tag value.

    The tag format is "foreground:background:overlay[:text]", e.g.
    "orange:orange:white_right:blue_stripe". We look for a known color
    name in any colon-separated segment.
    """
    known = {"red", "blue", "green", "black", "orange", "white", "yellow"}
    for part in osmc_symbol.split(":"):
        # A segment may be "white_right" — check the first word.
        word = part.split("_")[0]
        if word in known:
            return word
    return ""


def _haversine(p1: tuple[float, float], p2: tuple[float, float]) -> float:
    """Return the great-circle distance in metres between two (lat, lon) points."""
    R = 6_371_000  # Earth radius in metres
    lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
    lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _classify_difficulty(distance_km: float, elevation_gain_m: float) -> str:
    """Return easy / moderate / hard based on distance and elevation gain.

    Uses a simple weighted score: every 100 m of gain counts as 1 km.
    This mirrors common Israeli trail grading conventions.
    """
    score = distance_km + elevation_gain_m / 100
    if score < 5:
        return "easy"
    elif score < 15:
        return "moderate"
    else:
        return "hard"


def _export_pdf(args: dict) -> dict:
    """Render `content` as a PDF at `filename` using ReportLab.

    Splits the input on blank lines into paragraphs (single newlines are
    preserved as soft line breaks within a paragraph). All text is
    XML-escaped before being handed to ReportLab's `Paragraph`, which
    parses a mini-HTML dialect — without escaping, content containing
    `<`, `>`, or `&` would crash the build.

    Returns `{"status": "success", "path": filename}` on success, or
    `{"status": "error", "message": str(e)}` on any failure. The error
    branch is intentionally broad so a tool failure surfaces back to the
    LLM as data rather than as an exception that aborts the loop.
    """
    try:
        filename = args["filename"]
        content = args["content"]

        doc = SimpleDocTemplate(filename)
        body_style = getSampleStyleSheet()["BodyText"]

        # Build a list of flowables: one Paragraph + one Spacer per
        # blank-line-separated paragraph in the input.
        story = []
        for paragraph in content.split("\n\n"):
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            story.append(Paragraph(xml_escape(paragraph), body_style))
            story.append(Spacer(1, 12))

        doc.build(story)
        return {"status": "success", "path": filename}
    except Exception as e:
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    # Smoke test: build the registry and exercise `export_pdf` end-to-end.
    # Writes `trailmate_sample.pdf` into the current working directory.
    registry = ToolRegistry()
    sample_text = (
        "TrailMate Sample Report\n\n"
        "This PDF was produced by the export_pdf tool to verify that the "
        "ToolRegistry is wired up correctly.\n\n"
        "If you can read this in a real PDF viewer, the round-trip works."
    )
    result = registry.execute(
        "export_pdf",
        {"filename": "trailmate_sample.pdf", "content": sample_text},
    )
    print(result)
