"""Registry of tools the agent can call, plus their local executors.

Each tool entry is a pair of:
- `schema`: the dict format `chat.completions.create(tools=[...])` expects
- `exec`:   a plain Python callable that takes the parsed arguments dict
            and returns a JSON-serialisable result the model can read back.
"""

from __future__ import annotations

import json
from typing import Any, Callable
from xml.sax.saxutils import escape as xml_escape

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
        - `export_pdf` — write text to a PDF on local disk via ReportLab.
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
