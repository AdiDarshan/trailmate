"""Tests for ToolRegistry.

These avoid hitting any network. The PDF round-trip writes a real
file but does so under pytest's `tmp_path` so nothing leaks into the
working tree.
"""

import json
from unittest.mock import MagicMock, patch

import requests

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


# ---------------------------------------------------------------------------
# search_trails tests — all HTTP calls mocked; no network required.
# ---------------------------------------------------------------------------

IHM_SEARCH_RESPONSE = [
    {
        "id": "relation_12345",
        "source": "OSM",
        "title": "Carmel Trail",
        "displayName": "Carmel Trail, Haifa",
        "icon": "icon-hike",
        "iconColor": "black",
        "location": {"lat": 32.75, "lng": 34.97, "alt": None},
        "hasExtraData": True,
    },
    # Non-hiking result — should be filtered out.
    {
        "id": "node_99999",
        "source": "OSM",
        "title": "Carmel Hotel",
        "displayName": "Carmel Hotel, Haifa",
        "icon": "icon-search",
        "iconColor": "black",
        "location": {"lat": 32.80, "lng": 34.99, "alt": None},
        "hasExtraData": False,
    },
]

OVERPASS_TAGS_RESPONSE = {
    "elements": [
        {
            "tags": {
                "name:en": "Carmel Trail",
                "osmc:symbol": "blue:white:blue_stripe",
                "network": "rwn",
                "ref": "42",
                "description": "A scenic trail through the Carmel mountains.",
            }
        }
    ]
}

OVERPASS_GEOM_RESPONSE = {
    "elements": [
        {
            "geometry": [
                {"lat": 32.750, "lon": 34.970},
                {"lat": 32.755, "lon": 34.975},
                {"lat": 32.760, "lon": 34.980},
            ]
        }
    ]
}

IHM_ELEVATION_RESPONSE = [100.0, 150.0, 120.0]


def _make_mock_response(json_data, status_code=200):
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = json_data
    mock.raise_for_status = MagicMock()
    return mock


def test_search_trails_registered():
    registry = ToolRegistry()
    assert "search_trails" in registry.registry
    schema = registry.registry["search_trails"]["schema"]
    props = schema["function"]["parameters"]["properties"]
    assert "query" in props
    assert "language" in props
    assert "max_results" in props
    assert schema["function"]["parameters"]["required"] == ["query"]


def test_search_trails_missing_query():
    registry = ToolRegistry()
    result = registry.execute("search_trails", {})
    assert result["status"] == "error"
    assert "query" in result["message"].lower()


def test_search_trails_no_hiking_results():
    """When IHM returns results but none are icon-hike, return empty list."""
    non_hike = [{**IHM_SEARCH_RESPONSE[1]}]  # only the hotel

    with patch("trailmate.tool_registry.requests.get",
               return_value=_make_mock_response(non_hike)):
        registry = ToolRegistry()
        result = registry.execute("search_trails", {"query": "Carmel"})

    assert result["status"] == "success"
    assert result["count"] == 0
    assert result["trails"] == []


def test_search_trails_full_enrichment():
    """Happy path: search → Overpass tags → geometry → elevation → difficulty."""
    get_responses = {
        "israelhiking": _make_mock_response(IHM_SEARCH_RESPONSE),
        "elevation": _make_mock_response(IHM_ELEVATION_RESPONSE),
    }
    post_responses = [
        _make_mock_response(OVERPASS_TAGS_RESPONSE),   # tags call
        _make_mock_response(OVERPASS_GEOM_RESPONSE),   # geometry call
    ]

    def mock_get(url, **kwargs):
        if "elevation" in url:
            return get_responses["elevation"]
        return get_responses["israelhiking"]

    with patch("trailmate.tool_registry.requests.get", side_effect=mock_get), \
         patch("trailmate.tool_registry.requests.post", side_effect=post_responses):
        registry = ToolRegistry()
        result = registry.execute("search_trails", {"query": "Carmel"})

    assert result["status"] == "success"
    assert result["count"] == 1
    trail = result["trails"][0]
    assert trail["name"] == "Carmel Trail"
    assert trail["trail_color"] == "blue"
    assert trail["network"] == "regional"
    assert trail["ref"] == "42"
    assert "description" in trail
    assert "distance_km" in trail
    assert "elevation_gain_m" in trail
    assert trail["difficulty"] in ("easy", "moderate", "hard")


def test_search_trails_uses_osm_distance_tag_skips_geometry():
    """If OSM tags already include distance, skip the geometry + elevation calls."""
    tags_with_distance = {
        "elements": [
            {
                "tags": {
                    "osmc:symbol": "red:white:red_stripe",
                    "network": "lwn",
                    "distance": "8.5",
                }
            }
        ]
    }
    post_call_count = []

    def mock_post(url, **kwargs):
        post_call_count.append(1)
        return _make_mock_response(tags_with_distance)

    with patch("trailmate.tool_registry.requests.get",
               return_value=_make_mock_response(IHM_SEARCH_RESPONSE)), \
         patch("trailmate.tool_registry.requests.post", side_effect=mock_post):
        registry = ToolRegistry()
        result = registry.execute("search_trails", {"query": "Carmel"})

    assert result["status"] == "success"
    trail = result["trails"][0]
    assert trail["distance_km"] == 8.5
    # Only one POST (tags); geometry POST should NOT have been made.
    assert len(post_call_count) == 1


def test_search_trails_overpass_failure_returns_partial_result():
    """If Overpass is unreachable, still return the basic IHM data."""
    def mock_post(*args, **kwargs):
        raise requests.exceptions.ConnectionError("Overpass down")

    with patch("trailmate.tool_registry.requests.get",
               return_value=_make_mock_response(IHM_SEARCH_RESPONSE)), \
         patch("trailmate.tool_registry.requests.post", side_effect=mock_post):
        registry = ToolRegistry()
        result = registry.execute("search_trails", {"query": "Carmel"})

    assert result["status"] == "success"
    assert result["count"] == 1
    trail = result["trails"][0]
    # Basic fields from IHM search must always be present.
    assert trail["name"] == "Carmel Trail"
    assert trail["location"]["lat"] == 32.75
    # Enriched fields should be absent — not present as None.
    assert "trail_color" not in trail
    assert "distance_km" not in trail


def test_search_trails_max_results_capped_at_5():
    """max_results above 5 should be silently capped."""
    many_trails = [
        {
            "id": f"relation_{i}",
            "source": "OSM",
            "title": f"Trail {i}",
            "displayName": f"Trail {i}, Israel",
            "icon": "icon-hike",
            "iconColor": "black",
            "location": {"lat": 32.0 + i * 0.01, "lng": 35.0, "alt": None},
            "hasExtraData": False,
        }
        for i in range(10)
    ]
    empty_overpass = {"elements": [{"tags": {}}]}

    with patch("trailmate.tool_registry.requests.get",
               return_value=_make_mock_response(many_trails)), \
         patch("trailmate.tool_registry.requests.post",
               return_value=_make_mock_response(empty_overpass)):
        registry = ToolRegistry()
        result = registry.execute("search_trails", {"query": "trail", "max_results": 99})

    assert result["count"] <= 5
