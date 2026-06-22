"""Registry of tools the agent can call, plus their local executors.

Each tool entry is a pair of:
- `schema`: the dict format `chat.completions.create(tools=[...])` expects
- `exec`:   a plain Python callable that takes the parsed arguments dict
            and returns a JSON-serialisable result the model can read back.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable
from xml.sax.saxutils import escape as xml_escape

from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


# Absolute path to the project root — used by run_script and read_file to set
# the working directory and to constrain file access to the project tree.
_PROJECT_ROOT = Path(__file__).parent.parent.parent


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
        - `run_script`   — execute a skill script via subprocess and return stdout.
        - `read_file`    — read a file from the project tree (for on-demand refs).

        Domain-specific tools (weather, trails, trip planning) are no longer
        registered here — the agent invokes them by calling `run_script` with
        the appropriate skill script path as instructed in <available_skills>.
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
                        "description": (
                            "Trip start date as YYYY-MM-DD. "
                            "Omit to get today's forecast."
                        ),
                    },
                    "days": {
                        "type": "integer",
                        "description": "Number of days to forecast (1–16). Defaults to 3.",
                    },
                },
                "required": ["location"],
            },
            func=_get_weather,
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
            func=_run_script,
        )
        self.register(
            name="read_file",
            description=(
                "Read a file from the project tree and return its text content. "
                "Use for on-demand loading of skill reference files — for example "
                "`.agents/skills/weather-extractor/references/field_spec.md` when "
                "a field is missing or ambiguous. Do not load reference files on "
                "every run; only fetch them when needed."
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
            func=_read_file,
        )


def _run_script(args: dict) -> dict:
    """Run a shell command from the project root and return stdout/stderr/returncode.

    `shell=True` is intentional — skill scripts are invoked exactly as written
    in their SKILL.md (e.g. `python scripts/extract.py "Tel Aviv"`). cwd is
    pinned to the project root so relative paths in commands resolve correctly.
    A 180-second timeout prevents runaway scripts from blocking the agent loop.
    The pipeline makes multiple sequential Overpass API calls which can take 90s+.
    Uses Popen instead of subprocess.run to avoid the post-kill communicate() hang.
    """
    command = args.get("command", "").strip()
    if not command:
        return {"status": "error", "message": "command is required"}
    try:
        proc = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(_PROJECT_ROOT),
        )
        try:
            stdout, stderr = proc.communicate(timeout=180)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            return {"status": "error", "message": "Script timed out after 180s"}
        return {
            "status": "success" if proc.returncode == 0 else "error",
            "stdout": stdout,
            "stderr": stderr,
            "returncode": proc.returncode,
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def _read_file(args: dict) -> dict:
    """Read a file from the project tree and return its text content.

    Resolves *path* relative to the project root and checks that the resolved
    absolute path still lives inside the project root before reading, preventing
    directory-traversal attacks (e.g. `../../etc/passwd`).
    """
    path = args.get("path", "").strip()
    if not path:
        return {"status": "error", "message": "path is required"}
    try:
        full_path = (_PROJECT_ROOT / path).resolve()
        if not str(full_path).startswith(str(_PROJECT_ROOT.resolve())):
            return {"status": "error", "message": "Access denied: path outside project root"}
        content = full_path.read_text(encoding="utf-8")
        return {"status": "success", "content": content}
    except FileNotFoundError:
        return {"status": "error", "message": f"File not found: {path}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}



_WEATHER_SCRIPT = _PROJECT_ROOT / ".agents" / "skills" / "plan-israel-trip" / "scripts" / "get_weather.py"


def _get_weather(args: dict) -> dict:
    """Call get_weather.py and return its parsed JSON output.

    Delegates entirely to the skill script so the tool stays a thin wrapper —
    no weather logic lives here. The script handles geocoding, forecast vs.
    historical proxy selection, and field normalisation.
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
