"""Registry of tools the agent can call, plus their local executors.

Each tool entry is a pair of:
- ``schema``: the dict format ``chat.completions.create(tools=[...])`` expects
- ``exec``:   a plain Python callable that takes the parsed arguments dict
              and returns a JSON-serialisable result the model can read back.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from trailmate.logging_config import get_logger
from trailmate.tools.itinerary import save_itinerary
from trailmate.tools.pdf import export_pdf
from trailmate.tools.runners import read_file, run_script
from trailmate.tools.weather import get_weather

logger = get_logger(__name__)


class ToolRegistry:
    """Name → (OpenAI tool schema + local callable) registry.

    Construction registers the project's built-in tools via
    ``_init_tools``. Callers may add more at runtime with ``register``.
    """

    def __init__(self) -> None:
        # Underlying store. Each value is ``{"schema": ..., "exec": ...}``.
        self.registry: dict[str, dict[str, Any]] = {}
        self._init_tools()

    def register(
        self,
        name: str,
        description: str,
        parameters: dict,
        func: Callable[[dict], Any],
    ) -> None:
        """Add a tool, overwriting any existing entry with the same name.

        ``parameters`` must be a valid JSON Schema object. ``func``
        receives the parsed arguments as a single dict.
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
        """Return every registered tool's schema in registration order.

        This is the exact value to pass to ``chat.completions.create`` as
        ``tools=...``.
        """
        return [item["schema"] for item in self.registry.values()]

    def execute(self, name: str, arguments_str: str | dict) -> Any:
        """Dispatch a tool call by name.

        Accepts a JSON-encoded string (as sent by OpenAI) or a pre-parsed
        dict (for in-process callers such as tests).
        """
        if isinstance(arguments_str, str):
            args = json.loads(arguments_str)
        else:
            args = arguments_str

        if name not in self.registry:
            logger.error("execute: unknown tool %r", name)
            raise KeyError(f"Unknown tool: {name}")

        logger.debug("execute: %s args=%s", name, json.dumps(args, default=str)[:200])
        try:
            return self.registry[name]["exec"](args)
        except Exception:
            logger.exception("execute: tool %r raised", name)
            raise

    def _init_tools(self) -> None:
        """Register the project's built-in tools."""
        self.register(
            name="export_pdf",
            description="Exports the given text content to a PDF file and saves it locally",
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
            func=export_pdf,
        )
        self.register(
            name="get_weather",
            description=(
                "Fetch a weather forecast for any location and date. "
                "Use proactively whenever dates and outdoor activity are involved: "
                "before recommending a trail, when the user mentions a trip date, "
                "or when checking whether conditions suit a planned activity. "
                "Within 16 days of today returns a live forecast; further out "
                "returns a historical proxy (same calendar period, previous year) "
                "flagged with 'historical: true' — tell the user when this applies."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "City or region in Israel, e.g. 'Tel Aviv', 'Golan Heights'.",
                    },
                    "date": {
                        "type": "string",
                        "description": "Trip start date as YYYY-MM-DD. Omit to get today's forecast.",
                    },
                    "days": {
                        "type": "integer",
                        "description": "Number of days to forecast (1–16). Defaults to 3.",
                    },
                },
                "required": ["location"],
            },
            func=get_weather,
        )
        self.register(
            name="run_script",
            description=(
                "Run a shell command from the project root and return its stdout, "
                "stderr, and return code. Use this to execute skill scripts exactly "
                "as instructed in <available_skills> — for example: "
                "`python .agents/skills/weather-extractor/scripts/extract.py 'Tel Aviv'`. "
                "Never reimplement what a skill script already does."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": (
                            "Shell command to run, relative to project root. "
                            "Example: \"python .agents/skills/weather-extractor/scripts/extract.py 'Tel Aviv'\""
                        ),
                    },
                },
                "required": ["command"],
            },
            func=run_script,
        )
        self.register(
            name="read_file",
            description=(
                "Read a file from the project tree and return its text content. "
                "Use for on-demand loading of skill reference files. "
                "Do not load reference files on every run; only fetch them when needed."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": (
                            "Path relative to project root. "
                            "Example: \".agents/skills/weather-extractor/references/field_spec.md\""
                        ),
                    },
                },
                "required": ["path"],
            },
            func=read_file,
        )
        self.register(
            name="save_itinerary",
            description=(
                "Save the completed trip itinerary as structured JSON so it can be "
                "displayed in the notebook UI. Call this ONCE at the very end of trip "
                "planning, after presenting the full itinerary to the user. "
                "Always call it — even if some fields are missing. Omit unavailable "
                "fields rather than skipping the call entirely."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "title":  {"type": "string", "description": "Trip title, e.g. '2-Day Trip: Galilee'"},
                    "dates":  {"type": "string", "description": "Human-readable date range, e.g. 'June 23–24, 2026'"},
                    "days": {
                        "type": "array",
                        "description": "One entry per day.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "day_number":   {"type": "integer"},
                                "date":         {"type": "string", "description": "e.g. 'Monday, June 23'"},
                                "weather":      {"type": "string", "description": "e.g. 'Partly cloudy, 28°C'"},
                                "weather_note": {"type": "string", "description": "Hot/rain/wind warning if any"},
                                "trail": {
                                    "type": "object",
                                    "properties": {
                                        "name":        {"type": "string"},
                                        "distance_km": {"type": "string"},
                                        "duration":    {"type": "string"},
                                        "difficulty":  {"type": "string"},
                                        "start_maps":  {"type": "string", "description": "Google Maps URL for trailhead"},
                                        "waze":        {"type": "string"},
                                        "tiuli_url":   {"type": "string"},
                                        "description": {"type": "string"},
                                    },
                                },
                                "lunch":  {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string"},
                                        "address": {"type": "string"},
                                        "maps": {"type": "string"},
                                    },
                                },
                                "dinner": {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string"},
                                        "address": {"type": "string"},
                                        "maps": {"type": "string"},
                                    },
                                },
                                "hotel": {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string"},
                                        "address": {"type": "string"},
                                        "maps": {"type": "string"},
                                    },
                                },
                            },
                            "required": ["day_number", "date"],
                        },
                    },
                },
                "required": ["title", "days"],
            },
            func=save_itinerary,
        )
