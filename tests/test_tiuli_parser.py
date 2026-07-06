"""Tests for the tiuli page parser (rich extraction).

Runs entirely offline against a saved page fixture (tests/fixtures/tiuli_track1.html,
tiuli track #1 — מבצר יחיעם ונחל געתון). Asserts the structured signals the search
engine relies on: geography, difficulty level, and feature flags.
"""

import sys
from pathlib import Path

import pytest

# The parser lives in the skill script tree, not the installed package.
_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT / ".agents" / "skills" / "fetch-tiuli-trail" / "scripts"))

from get_tiuli_trail import (  # noqa: E402
    classify_features,
    extract_difficulty_and_distance,
    parse_tiuli_page,
)

FIXTURE = _ROOT / "tests" / "fixtures" / "tiuli_track1.html"


@pytest.fixture(scope="module")
def parsed() -> dict:
    html = FIXTURE.read_text(encoding="utf-8")
    return parse_tiuli_page(html, "https://www.tiuli.com/tracks/1/x")


def test_geography_from_dimensions(parsed):
    assert parsed["area_he"] == "צפון"
    assert parsed["area_en"] == "North"
    assert parsed["region_he"] == "גליל מערבי"
    assert parsed["subregion_he"] == "עכו נהריה וראש הנקרה"
    assert parsed["city_he"] == "יחיעם"


def test_geo_coords_from_jsonld(parsed):
    assert parsed["trailhead_coords"] == {"lat": 33.0115, "lng": 35.1826}


def test_difficulty_and_distance_from_pill(parsed):
    # The difficulty-pill reads "בינוני, 3 ק\"מ" — medium (level 3), 3 km.
    # (The old difficulty=N regex wrongly read a static footer link as "easy".)
    assert parsed["difficulty_level"] == 3
    assert parsed["difficulty_he"] == "בינוני"
    assert parsed["distance_km"] == 3.0


def test_difficulty_pill_range_takes_low_end():
    out = extract_difficulty_and_distance(
        '<div class="difficulty-pill"><span class="icon icon-level_hardbody icon1">'
        '</span>...רמת קושי</span></div><span>קשה, 8.5-12 ק&quot;מ</span></div>'
    )
    assert out["difficulty_level"] == 4
    assert out["difficulty_he"] == "קשה"
    assert out["distance_km"] == 8.5


def test_difficulty_pill_slug_fallback():
    # No Hebrew label → fall back to the icon slug.
    out = extract_difficulty_and_distance(
        '<div class="difficulty-pill"><span class="icon icon-level_veryhardbody">'
        '</span>...רמת קושי</span></div><span></span></div>'
    )
    assert out["difficulty_level"] == 5


def test_description_is_editorial_not_marketing(parsed):
    # The JSON-LD description is real editorial copy, not the OG "how fun!" blurb.
    assert "נחל געתון" in parsed["description_he"]
    assert "איזה כיף" not in parsed["description_he"]


def test_features_and_flags(parsed):
    assert parsed["features"] == ["family", "romantic", "bike", "loop"]
    assert parsed["is_loop"] is True
    assert parsed["family_friendly"] is True
    assert parsed["bike_friendly"] is True
    assert parsed["romantic"] is True
    # No false positives from substring collisions or unrelated site nav.
    assert parsed["stroller_ok"] is False
    assert parsed["has_water"] is False
    assert parsed["dog_friendly"] is False


def test_loop_not_misclassified_as_stroller():
    # "מעגלי" (loop) contains "עגל" (stroller root) — ordering must resolve to loop.
    out = classify_features("מעגלי")
    assert out["is_loop"] is True
    assert out["stroller_ok"] is False
    assert out["features"] == ["loop"]


def test_stroller_still_detected():
    out = classify_features("מתאים לעגלות תינוק")
    assert out["stroller_ok"] is True
    assert "stroller" in out["features"]


def test_flags_default_false_on_empty():
    out = classify_features("")
    assert out["features"] == []
    assert all(out[flag] is False for flag in ("is_loop", "has_water", "family_friendly"))
