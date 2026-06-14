"""Registry of tools the agent can call, plus their local executors.

Each tool entry is a pair of:
- `schema`: the dict format `chat.completions.create(tools=[...])` expects
- `exec`:   a plain Python callable that takes the parsed arguments dict
            and returns a JSON-serialisable result the model can read back.
"""

from __future__ import annotations

import json
import os
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
        - `export_pdf`   — write text to a PDF on local disk via ReportLab.
        - `get_weather`  — fetch current weather for a city via OpenWeatherMap.
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
