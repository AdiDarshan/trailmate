"""Tests for the Nakeb page parser (offline, against a saved fixture).

Fixture: tests/fixtures/nakeb_hike357.html (nakeb.co.il/hike/357 —
שביל הנגב המערבי - מקטע שני). Asserts the fields the search engine relies on.
"""

import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT / "scripts"))

from nakeb_parser import classify_features, parse_nakeb_page  # noqa: E402

FIXTURE = _ROOT / "tests" / "fixtures" / "nakeb_hike357.html"


@pytest.fixture(scope="module")
def parsed() -> dict:
    html = FIXTURE.read_text(encoding="utf-8", errors="replace")
    return parse_nakeb_page(html, "https://www.nakeb.co.il/hike/357")


def test_identity(parsed):
    assert parsed["source"] == "nakeb"
    assert "שביל הנגב המערבי" in parsed["name_he"]
    assert "נקודות העניין" in parsed["description_he"]
    assert parsed["url"].endswith("/hike/357")


def test_image_absolute(parsed):
    assert parsed["trail_map_image"].startswith("https://www.nakeb.co.il/")
    assert "357" in parsed["trail_map_image"]


def test_difficulty(parsed):
    assert parsed["difficulty"] == "מיטיבי לכת"
    assert parsed["difficulty_level"] == 5
    assert parsed["for_serious_hikers"] is True


def test_distance(parsed):
    assert parsed["distance_km"] == 17.5


def test_season(parsed):
    assert parsed["seasons"] == ["חורף", "אביב"]


def test_region_from_keywords(parsed):
    # Nakeb's native region is the 2nd meta keyword.
    assert parsed["region_he"] == "מישור חוף הנגב"


def test_features_and_flags(parsed):
    # מאפיינים: "מסומן לכל אורכו", "מתאים לכלבים" → dog-friendly + marked.
    assert parsed["dog_friendly"] is True
    assert "dog" in parsed["features"]
    assert "marked" in parsed["features"]


def test_coords(parsed):
    assert round(parsed["lat"], 4) == 31.5539
    assert round(parsed["lng"], 4) == 34.5852
    assert "waze.com" in parsed["waze_link"]


def test_classify_features_dedup_and_flags():
    out = classify_features(["מתאים לכלבים", "מתאים למשפחות", "מעגלי"])
    assert out["dog_friendly"] and out["family_friendly"] and out["is_loop"]
    assert out["features"] == ["dog", "family", "loop"]


def test_classify_features_respects_negation():
    # "לא מתאים לכלבים" / "לא מסומן" must NOT set the positive flag.
    out = classify_features(["לא מתאים לכלבים", "לא מסומן לכל אורכו", "אפשרות כניסה למים"])
    assert out["dog_friendly"] is False
    assert "dog" not in out["features"] and "marked" not in out["features"]
    assert out["has_water"] is True  # "אפשרות כניסה למים" is a positive
    # raw list keeps everything for transparency
    assert "לא מתאים לכלבים" in out["features_he"]
