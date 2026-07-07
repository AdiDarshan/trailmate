#!/usr/bin/env python3
"""Parse a nakeb.co.il /hike/{id} page into a structured trail record.

Nakeb pages are server-rendered. The signal lives in:
  - og: meta tags        → name, description, image
  - an attribute list    → <b>Label</b><br/>Value<hr/> items (difficulty, season,
                            features/suitability, length)
  - a Google-Maps link   → daddr=lat,lng gives the trailhead

Region is NOT on the page — it's assigned later from the coordinates (bbox), so
the output mirrors the Tiuli seed schema minus region_he/area_he.
"""

from __future__ import annotations

import re
from html import unescape
from typing import Any

NAKEB_BASE = "https://www.nakeb.co.il"

# Nakeb difficulty label → numeric level (1–5), aligned with the Tiuli scale.
# Longer/more-specific labels first so "קשה מאוד" isn't shadowed by "קשה", etc.
DIFFICULTY_LABEL_TO_LEVEL = [
    ("קל מאוד", 1),
    ("קשה מאוד", 5),
    ("מיטיבי לכת", 5),
    ("משפחתי", 2),
    ("בינוני", 3),
    ("קשה", 4),
    ("קל", 2),
]

# Feature classification for the מאפיינים (characteristics) list — same flag set as
# the Tiuli parser so both sources populate identical columns.
FEATURE_RULES: list[tuple[str, str, tuple[str, ...]]] = [
    ("מעגל", "loop", ("is_loop",)),
    ("עגל", "stroller", ("stroller_ok", "family_friendly")),
    ("משפח", "family", ("family_friendly",)),
    ("ילד", "kids", ("family_friendly",)),
    ("כלב", "dog", ("dog_friendly",)),
    ("אופני", "bike", ("bike_friendly",)),
    ("רטוב", "water", ("has_water",)),
    ("מעיינ", "spring", ("has_water",)),
    ("מים", "water", ("has_water",)),
    ("נגיש", "accessible", ("accessible",)),
    ("תצפי", "viewpoint", ("has_viewpoint",)),
    ("עירונ", "urban", ("urban",)),
    ("פריח", "bloom", ()),
    ("מסומן", "marked", ()),
]
FEATURE_FLAGS = (
    "family_friendly", "stroller_ok", "dog_friendly", "bike_friendly",
    "is_loop", "romantic", "has_water", "accessible", "urban",
    "for_serious_hikers", "has_viewpoint",
)


def _meta(html: str, prop: str) -> str:
    """Read an og:/meta content value (attributes in either order)."""
    m = re.search(rf'<meta[^>]+(?:property|name)="{prop}"[^>]+content="([^"]*)"', html) or \
        re.search(rf'<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="{prop}"', html)
    return unescape(m.group(1).strip()) if m else ""


def _strip(s: str) -> str:
    return unescape(re.sub(r"<[^>]+>", " ", s)).strip()


def _attributes(html: str) -> dict[str, str]:
    """Pull the <b>Label</b><br/>Value…<hr/|</li>> attribute list into {label: value}."""
    out: dict[str, str] = {}
    for label, raw in re.findall(
        r"<b>([^<]+)</b>\s*<br\s*/?>(.*?)(?=<hr|</li>)", html, re.DOTALL
    ):
        out[label.strip()] = raw
    return out


def classify_features(items: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {flag: False for flag in FEATURE_FLAGS}
    slugs: list[str] = []
    raw: list[str] = []
    for item in items:
        item = item.strip()
        if not item:
            continue
        raw.append(item)
        # Nakeb lists attributes as yes/no phrases — "מתאים לכלבים" vs "לא מתאים
        # לכלבים", "מסומן…" vs "לא מסומן…". Skip negated ones so we don't flag the
        # opposite (a substring match alone can't tell them apart).
        if item.startswith("לא") or "אסור" in item:
            continue
        for hebrew_sub, slug, flags in FEATURE_RULES:
            if hebrew_sub in item:
                if slug not in slugs:
                    slugs.append(slug)
                for flag in flags:
                    out[flag] = True
                break
    out["features"] = slugs
    out["features_he"] = raw
    return out


def parse_nakeb_page(html: str, url: str) -> dict[str, Any]:
    result: dict[str, Any] = {"source": "nakeb", "url": url}

    result["name_he"] = _meta(html, "og:title")
    result["description_he"] = _meta(html, "og:description")
    img = _meta(html, "og:image")
    if img:
        result["trail_map_image"] = img if img.startswith("http") else NAKEB_BASE + img

    attrs = _attributes(html)

    # Difficulty (label + numeric level; "מיטיבי לכת" also flags serious-hiker).
    diff = _strip(attrs.get("רמת קושי", ""))
    if diff:
        result["difficulty"] = diff
        for hebrew, level in DIFFICULTY_LABEL_TO_LEVEL:
            if hebrew in diff:
                result["difficulty_level"] = level
                break

    # Length in km — "17.5 ק\"מ".
    length = _strip(attrs.get("אורך המסלול", ""))
    lm = re.search(r"([\d.]+)", length)
    if lm:
        try:
            result["distance_km"] = float(lm.group(1))
        except ValueError:
            pass

    # Region — Nakeb's own tag is the 2nd meta keyword (e.g. "מישור חוף הנגב",
    # "החרמון הגולן ואצבע הגליל"). Toponym-rich, so it matches the region filter
    # across sources. area_he (North/South/…) is assigned later via k-NN.
    kw = _meta(html, "keywords")
    if kw:
        parts = [p.strip() for p in kw.split(",") if p.strip()]
        if len(parts) > 1:
            result["region_he"] = parts[1].split("|")[0].strip()

    # Recommended season(s) — "חורף|אביב".
    season = _strip(attrs.get("עונה מומלצת", ""))
    if season:
        result["seasons"] = [s.strip() for s in re.split(r"[|,/]", season) if s.strip()]

    # Features / suitability list (multiple <br/>-separated values).
    feat_items = [_strip(x) for x in re.split(r"<br\s*/?>", attrs.get("מאפיינים", ""))]
    result.update(classify_features([x for x in feat_items if x]))
    if "מיטיבי לכת" in diff:
        result["for_serious_hikers"] = True

    # Trailhead coordinates from the Google-Maps directions link (daddr=lat,lng).
    coord = re.search(r"daddr=(-?\d+\.\d+),(-?\d+\.\d+)", html)
    if coord:
        lat, lng = float(coord.group(1)), float(coord.group(2))
        result["lat"] = lat
        result["lng"] = lng
        result["waze_link"] = f"https://waze.com/ul?navigate=yes&ll={lat},{lng}"

    return result
