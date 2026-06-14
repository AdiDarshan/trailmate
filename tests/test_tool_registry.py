"""Tests for ToolRegistry.

These avoid hitting any network. The PDF round-trip writes a real
file but does so under pytest's `tmp_path` so nothing leaks into the
working tree.
"""

import json
from unittest.mock import MagicMock, patch

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
    assert "get_weather" in names


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


# ---------------------------------------------------------------------------
# get_weather tests — all HTTP calls are mocked; no network required.
# ---------------------------------------------------------------------------

def test_get_weather_registered():
    registry = ToolRegistry()
    assert "get_weather" in registry.registry
    schema = registry.registry["get_weather"]["schema"]
    props = schema["function"]["parameters"]["properties"]
    assert "city" in props
    assert "units" in props


def test_get_weather_success(monkeypatch):
    monkeypatch.setenv("OPENWEATHERMAP_API_KEY", "test-key")

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {
        "name": "Lisbon",
        "sys": {"country": "PT"},
        "weather": [{"description": "clear sky"}],
        "main": {"temp": 22.5, "feels_like": 21.0, "humidity": 60},
        "wind": {"speed": 3.5},
    }

    with patch("trailmate.tool_registry.requests.get", return_value=fake_response):
        registry = ToolRegistry()
        result = registry.execute("get_weather", {"city": "Lisbon"})

    assert result["status"] == "success"
    assert result["city"] == "Lisbon"
    assert result["country"] == "PT"
    assert result["condition"] == "clear sky"
    assert result["temperature"] == "22.5°C"
    assert result["feels_like"] == "21.0°C"
    assert result["humidity"] == "60%"
    assert result["wind_speed"] == "3.5 m/s"


def test_get_weather_imperial_units(monkeypatch):
    monkeypatch.setenv("OPENWEATHERMAP_API_KEY", "test-key")

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {
        "name": "New York",
        "sys": {"country": "US"},
        "weather": [{"description": "partly cloudy"}],
        "main": {"temp": 75.0, "feels_like": 73.0, "humidity": 55},
        "wind": {"speed": 10.0},
    }

    with patch("trailmate.tool_registry.requests.get", return_value=fake_response):
        registry = ToolRegistry()
        result = registry.execute("get_weather", {"city": "New York", "units": "imperial"})

    assert result["status"] == "success"
    assert result["temperature"] == "75.0°F"
    assert result["wind_speed"] == "10.0 mph"


def test_get_weather_missing_api_key(monkeypatch):
    monkeypatch.delenv("OPENWEATHERMAP_API_KEY", raising=False)

    registry = ToolRegistry()
    result = registry.execute("get_weather", {"city": "Paris"})

    assert result["status"] == "error"
    assert "OPENWEATHERMAP_API_KEY" in result["message"]


def test_get_weather_city_not_found(monkeypatch):
    monkeypatch.setenv("OPENWEATHERMAP_API_KEY", "test-key")

    fake_response = MagicMock()
    fake_response.status_code = 404

    with patch("trailmate.tool_registry.requests.get", return_value=fake_response):
        registry = ToolRegistry()
        result = registry.execute("get_weather", {"city": "NotARealCity"})

    assert result["status"] == "error"
    assert "not found" in result["message"].lower()


def test_get_weather_invalid_api_key(monkeypatch):
    monkeypatch.setenv("OPENWEATHERMAP_API_KEY", "bad-key")

    fake_response = MagicMock()
    fake_response.status_code = 401

    with patch("trailmate.tool_registry.requests.get", return_value=fake_response):
        registry = ToolRegistry()
        result = registry.execute("get_weather", {"city": "Tokyo"})

    assert result["status"] == "error"
    assert "Invalid" in result["message"]


def test_get_weather_missing_city_arg(monkeypatch):
    monkeypatch.setenv("OPENWEATHERMAP_API_KEY", "test-key")

    registry = ToolRegistry()
    result = registry.execute("get_weather", {})

    assert result["status"] == "error"
    assert "city" in result["message"].lower()
