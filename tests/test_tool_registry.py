"""Tests for ToolRegistry.

These avoid hitting any network. The PDF round-trip writes a real
file but does so under pytest's `tmp_path` so nothing leaks into the
working tree.
"""

import json

from trailmate.tool_registry import ToolRegistry


def test_init_registers_export_pdf_tool():
    registry = ToolRegistry()

    assert "export_pdf" in registry.registry
    schema = registry.registry["export_pdf"]["schema"]
    assert schema["type"] == "function"
    assert schema["function"]["name"] == "export_pdf"
    properties = schema["function"]["parameters"]["properties"]
    assert "filename" in properties
    assert "content" in properties


def test_get_tool_schemas_returns_every_registered_schema():
    registry = ToolRegistry()
    schemas = registry.get_tool_schemas()

    assert isinstance(schemas, list)
    names = [s["function"]["name"] for s in schemas]
    assert "export_pdf" in names
    assert "get_weather" in names  # registered tool for reliable proactive triggering
    assert "run_script" in names
    assert "read_file" in names
    assert "search_trails" not in names
    assert "plan_trip" not in names


def test_register_adds_tool_and_overwrites_existing():
    registry = ToolRegistry()
    registry.register(
        name="echo",
        description="Test echo tool.",
        parameters={"type": "object", "properties": {}},
        func=lambda args: {"echoed": args},
    )

    assert registry.execute("echo", "{}") == {"echoed": {}}

    registry.register(
        name="echo",
        description="Replacement.",
        parameters={"type": "object", "properties": {}},
        func=lambda args: "replaced",
    )
    assert registry.execute("echo", "{}") == "replaced"


def test_execute_accepts_pre_parsed_dict_arguments():
    registry = ToolRegistry()
    registry.register(
        name="passthrough",
        description="Test tool.",
        parameters={"type": "object", "properties": {}},
        func=lambda args: args,
    )

    assert registry.execute("passthrough", {"a": 1}) == {"a": 1}


def test_export_pdf_writes_a_real_pdf_file(tmp_path):
    registry = ToolRegistry()
    output = tmp_path / "out.pdf"

    result = registry.execute(
        "export_pdf",
        json.dumps(
            {"filename": str(output), "content": "Hello\n\nWorld with <special> chars & more."}
        ),
    )

    assert result == {"status": "success", "path": str(output)}
    assert output.exists()
    # Cheap sanity check that ReportLab actually produced PDF bytes.
    assert output.read_bytes().startswith(b"%PDF-")


def test_export_pdf_returns_error_dict_on_invalid_args():
    registry = ToolRegistry()

    result = registry.execute("export_pdf", "{}")

    assert result["status"] == "error"
    assert "message" in result
