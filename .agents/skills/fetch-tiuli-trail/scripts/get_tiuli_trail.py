#!/usr/bin/env python3
"""Fetch trail details from tiuli.com by trail name or URL.

Lookup strategy:
  1. Load the local index (.agents/data/tiuli_index.json).
  2. Find the best-matching trail by name (fuzzy, Hebrew-aware).
  3. Fetch the tiuli trail page and extract structured data.

Build the index first (one-time):
    python build_tiuli_index.py

Usage:
    python get_tiuli_trail.py "נחל ערוגות"
    python get_tiuli_trail.py "Arbel"
    python get_tiuli_trail.py --url "https://www.tiuli.com/tracks/154/..."

Exits 0 and prints a JSON object on success.
Exits 1 and prints {"error": "..."} on failure.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from html import unescape as html_unescape
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

TIMEOUT = 15
TIULI_BASE = "https://www.tiuli.com"
INDEX_PATH = Path(__file__).parent.parent.parent.parent.parent / ".agents" / "data" / "tiuli_index.json"

DIFFICULTY_MAP = {
    "1": "קל מאוד",
    "2": "קל",
    "3": "בינוני",
    "4": "קשה",
    "5": "קשה מאוד",
}

# Hebrew difficulty label → numeric level (1–5). Authoritative source: the visible
# text of the page's `difficulty-pill` (e.g. "בינוני, 3 ק\"מ"). NOTE: the earlier
# `difficulty=N` regex matched a static footer filter link, not the trail — do not
# use it. Longer labels checked first so "קשה מאוד" isn't shadowed by "קשה".
DIFFICULTY_LABEL_TO_LEVEL = [
    ("קל מאוד", 1),
    ("קשה מאוד", 5),
    ("בינוני", 3),
    ("קל", 2),
    ("קשה", 4),
]

# The pill also carries a CSS icon slug (icon-level_<slug>body) — used as a fallback
# when the visible label is missing or unrecognized.
LEVEL_SLUG_TO_LEVEL = {
    "veryeasy": 1, "easy": 2, "medium": 3, "hard": 4, "veryhard": 5,
}

# Top-level geographic area (dimension_area) → English gloss. Region/subregion are
# left in Hebrew (too many values to map exhaustively; the agent handles Hebrew).
AREA_EN = {
    "צפון": "North",
    "מרכז": "Center",
    "דרום": "South",
    "ירושלים": "Jerusalem",
    "יהודה ושומרון": "Judea and Samaria",
    "שפלה": "Shephelah",
    "חוף": "Coast",
    "ים המלח": "Dead Sea",
    "אילת": "Eilat",
}

# Feature classification. Each rule: (Hebrew substring, English slug, [boolean flags]).
# Matched against each pipe-separated token in the page's `dimension_feature` var —
# the authoritative per-trail feature list. Substring match tolerates spelling variants.
FEATURE_RULES: list[tuple[str, str, tuple[str, ...]]] = [
    ("מעגל", "loop", ("is_loop",)),        # מעגלי — must precede עגל (stroller), which it contains
    ("ליניאר", "linear", ()),
    ("קווי", "linear", ()),
    ("עגל", "stroller", ("stroller_ok", "family_friendly")),   # עגלות תינוק — before ילד/משפחה
    ("משפח", "family", ("family_friendly",)),
    ("ילד", "kids", ("family_friendly",)),
    ("כלב", "dog", ("dog_friendly",)),
    ("אופני", "bike", ("bike_friendly",)),
    ("רומנט", "romantic", ("romantic",)),
    ("רטוב", "water", ("has_water",)),
    ("מעיינ", "spring", ("has_water",)),
    ("מעין", "spring", ("has_water",)),
    ("מים", "water", ("has_water",)),
    ("נגיש", "accessible", ("accessible",)),
    ("עירונ", "urban", ("urban",)),
    ("מיטיב", "serious_hikers", ("for_serious_hikers",)),
    ("תצפי", "viewpoint", ("has_viewpoint",)),
    ("פריח", "bloom", ()),
    ("חוף", "beach", ()),
    ("פיקני", "picnic", ()),
]

# Boolean feature flags emitted on every record (default False → stable schema).
FEATURE_FLAGS = (
    "family_friendly", "stroller_ok", "dog_friendly", "bike_friendly",
    "is_loop", "romantic", "has_water", "accessible", "urban",
    "for_serious_hikers", "has_viewpoint",
)


# ── Fuzzy name matching ───────────────────────────────────────────────────────

# Common Hebrew geographic prefixes that shouldn't count as content tokens
_STOP_WORDS = {
    "נחל", "הר", "הרי", "שמורת", "שמורה", "מסלול", "טיול", "שביל",
    "עין", "תל", "גן", "מעיין", "ואדי", "מצוק", "מצפה",
    "trail", "nahal", "wadi", "mount", "nature",
}


def normalize(text: str) -> str:
    """Lowercase + strip niqqud/diacritics for Hebrew-aware comparison."""
    text = text.lower().strip()
    text = "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", text)


def content_tokens(text: str) -> set[str]:
    """Return meaningful tokens (stop words excluded)."""
    return {t for t in normalize(text).split() if t not in _STOP_WORDS and len(t) > 1}


def score_match(query: str, candidate: str) -> int:
    """Return a match score (higher = better). 0 means no match."""
    q_norm = normalize(query)
    c_norm = normalize(candidate)

    if q_norm == c_norm:
        return 100
    if q_norm in c_norm:
        # Substring match — weight by coverage
        return 70 + int(30 * len(q_norm) / max(len(c_norm), 1))
    if c_norm in q_norm:
        return 60

    # Content-token overlap (stop words excluded)
    q_tokens = content_tokens(query)
    c_tokens = content_tokens(candidate)
    if not q_tokens:
        return 0
    shared = q_tokens & c_tokens
    if not shared:
        return 0
    # Require >50% of query tokens to match (avoids single-word "נחל" hits)
    if len(shared) < max(1, len(q_tokens) // 2):
        return 0
    return 30 + int(40 * len(shared) / len(q_tokens))


def find_in_index(trail_name: str) -> dict | None:
    """Look up a trail by name in the local index. Returns the best match."""
    if not INDEX_PATH.exists():
        return None

    index: list[dict] = json.loads(INDEX_PATH.read_text(encoding="utf-8"))

    best_score = 0
    best_entry = None
    for entry in index:
        s = score_match(trail_name, entry["name"])
        # Also check subtitle (may contain sub-trail names like "נחל ערוגות")
        if entry.get("subtitle"):
            s = max(s, score_match(trail_name, entry["subtitle"]))
        # Check slug (URL-decoded, dashes → spaces)
        slug = urllib.parse.unquote(entry.get("slug", "")).replace("-", " ")
        s = max(s, score_match(trail_name, slug))

        if s > best_score:
            best_score = s
            best_entry = entry

    # Require meaningful match — single shared stop word is not enough
    return best_entry if best_score >= 55 else None


# ── HTTP fetch ────────────────────────────────────────────────────────────────

def fetch_html(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read().decode("utf-8")


# ── Structured-signal extractors ──────────────────────────────────────────────

def extract_jsonld(html: str) -> dict[str, Any]:
    """Merge the page's JSON-LD blocks (Article + TouristAttraction) into one dict.

    These carry the cleanest data: the editorial description (not the marketing OG
    blurb), precise geo coordinates, last-modified date, and author.
    """
    merged: dict[str, Any] = {}
    for block in re.findall(
        r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL
    ):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        for obj in data if isinstance(data, list) else [data]:
            if isinstance(obj, dict):
                merged.update({k: v for k, v in obj.items() if v not in (None, "")})
    return merged


def extract_dimensions(html: str) -> dict[str, str]:
    """Pull tiuli's `dimension_* = '...'` analytics vars — clean geo + feature data."""
    dims: dict[str, str] = {}
    for name, value in re.findall(r"dimension_([a-z_]+) = '([^']*)'", html):
        if value and value != "ללא":  # "ללא" = "none"
            dims[name] = value
    return dims


def extract_difficulty_and_distance(html: str) -> dict[str, Any]:
    """Parse the `difficulty-pill` block: authoritative difficulty + trail length.

    The pill renders an icon (icon-level_<slug>body) plus a visible label span such
    as "בינוני, 3 ק\"מ" ("Medium, 3 km") or "קל, 2.5-4 ק\"מ". We extract the numeric
    difficulty level and the distance in km (the low end of any range).
    Returns {} if no pill is present.
    """
    out: dict[str, Any] = {}
    i = html.find("difficulty-pill")
    if i == -1:
        return out
    window = html[i : i + 900]

    # Visible label span, e.g. "בינוני, 3 ק&quot;מ" (comes right after the "רמת קושי" caption).
    label_match = re.search(r"רמת קושי</span>\s*</div>\s*<span>([^<]+)</span>", window)
    label_text = html_unescape(label_match.group(1)) if label_match else ""

    # Difficulty: prefer the Hebrew label; fall back to the CSS icon slug.
    for hebrew, level in DIFFICULTY_LABEL_TO_LEVEL:
        if hebrew in label_text:
            out["difficulty_level"] = level
            out["difficulty_he"] = hebrew
            break
    if "difficulty_level" not in out:
        slug = re.search(r"icon-level_([a-z]+?)body", window)
        if slug and slug.group(1) in LEVEL_SLUG_TO_LEVEL:
            lvl = LEVEL_SLUG_TO_LEVEL[slug.group(1)]
            out["difficulty_level"] = lvl
            out["difficulty_he"] = DIFFICULTY_MAP[str(lvl)]

    # Distance in km — the number(s) before ק"מ in the label. Take the low end of a range.
    dist = re.search(r'([\d.]+)\s*(?:[-–]\s*([\d.]+)\s*)?ק"?מ', label_text)
    if dist:
        try:
            out["distance_km"] = float(dist.group(1))
        except ValueError:
            pass
    return out


def classify_features(feature_str: str) -> dict[str, Any]:
    """Map the pipe-separated `dimension_feature` list to English slugs + boolean flags.

    Returns {"features": [en slugs], "features_he": [raw], <flag>: bool, ...}.
    Every flag in FEATURE_FLAGS is present (default False) so the schema is stable.
    """
    out: dict[str, Any] = {flag: False for flag in FEATURE_FLAGS}
    slugs: list[str] = []
    raw: list[str] = []
    for token in (t.strip() for t in feature_str.split("|") if t.strip()):
        raw.append(token)
        for hebrew_sub, slug, flags in FEATURE_RULES:
            if hebrew_sub in token:
                if slug not in slugs:
                    slugs.append(slug)
                for flag in flags:
                    out[flag] = True
                break  # first matching rule wins (rules are ordered by specificity)
    out["features"] = slugs
    out["features_he"] = raw
    return out


# ── Parse tiuli trail page ────────────────────────────────────────────────────

def parse_tiuli_page(html: str, url: str) -> dict[str, Any]:
    result: dict[str, Any] = {"tiuli_url": url}
    jsonld = extract_jsonld(html)
    dims = extract_dimensions(html)

    # Name — prefer JSON-LD headline, fall back to <title> ("שם - אזור - אתר למטייל")
    if jsonld.get("headline"):
        result["name_he"] = str(jsonld["headline"]).strip()
    else:
        title = re.search(r"<title>([^<]+)</title>", html)
        if title:
            result["name_he"] = title.group(1).split(" - ")[0].strip()

    # Description — JSON-LD editorial intro is the real content; OG is a marketing blurb.
    if jsonld.get("description"):
        result["description_he"] = str(jsonld["description"]).strip()
    else:
        desc = re.search(r'property="og:description"[^>]+content="([^"]+)"', html)
        if desc:
            result["description_he"] = desc.group(1).strip()

    # Geo coordinates — JSON-LD GeoCoordinates first, then Waze button as fallback.
    geo = jsonld.get("geo") if isinstance(jsonld.get("geo"), dict) else None
    if geo and geo.get("latitude") and geo.get("longitude"):
        result["trailhead_coords"] = {
            "lat": float(geo["latitude"]),
            "lng": float(geo["longitude"]),
        }
    waze = re.search(
        r'waze\.com/ul\?navigate=yes&(?:amp;)?ll=([0-9.]+),([0-9.]+)', html
    )
    if waze:
        lat, lng = float(waze.group(1)), float(waze.group(2))
        result["waze_link"] = f"https://waze.com/ul?navigate=yes&ll={lat},{lng}"
        result.setdefault("trailhead_coords", {"lat": lat, "lng": lng})

    # Editorial metadata from JSON-LD.
    if jsonld.get("dateModified"):
        result["date_modified"] = str(jsonld["dateModified"])
    author = jsonld.get("author")
    if isinstance(author, dict) and author.get("name"):
        result["author"] = author["name"]

    # Geographic hierarchy from analytics dimensions.
    if dims.get("area"):
        result["area_he"] = dims["area"]
        result["area_en"] = AREA_EN.get(dims["area"], dims["area"])
    if dims.get("region"):
        result["region_he"] = dims["region"]
    if dims.get("subregion"):
        result["subregion_he"] = dims["subregion"]
    if dims.get("city"):
        result["city_he"] = dims["city"]

    # Features + boolean flags from the authoritative dimension_feature list.
    result.update(classify_features(dims.get("feature", "")))

    # Difficulty (real level, 1–5) + trail length in km, both from the difficulty-pill.
    result.update(extract_difficulty_and_distance(html))

    # Duration — prefer range ("3-4 שעות") over single ("3 שעות"). Often absent.
    durations = re.findall(r"\d+[-–]\d+\s*שעות|\d+\s*שעות|\d+\s*שעה", html)
    seen: set[str] = set()
    unique: list[str] = []
    for d in durations:
        d = d.strip()
        if d not in seen:
            seen.add(d)
            unique.append(d)
    if unique:
        result["duration_he"] = unique[0]

    # Trail map static image
    map_img = re.search(
        r'href="(https://www\.tiuli\.com/images/site/track_maps/[^"]+)"', html
    )
    if map_img:
        result["trail_map_image"] = map_img.group(1)

    return result


# ── Main flow ─────────────────────────────────────────────────────────────────

def fetch_by_name(trail_name: str) -> dict[str, Any]:
    if not INDEX_PATH.exists():
        return {
            "error": (
                "אינדקס tiuli.com לא נמצא. "
                "הרץ תחילה: python .agents/skills/fetch-tiuli-trail/scripts/build_tiuli_index.py"
            )
        }

    entry = find_in_index(trail_name)
    if not entry:
        return {"error": f"לא נמצא מסלול דומה ל-'{trail_name}' באינדקס tiuli.com"}

    html = fetch_html(entry["url"])
    result = parse_tiuli_page(html, entry["url"])
    result["index_match"] = entry["name"]  # debug: show what we matched
    return result


def fetch_by_url(url: str) -> dict[str, Any]:
    if "tiuli.com/tracks/" not in url:
        return {"error": f"כתובת לא תקינה: {url!r}"}
    html = fetch_html(url)
    return parse_tiuli_page(html, url)


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(json.dumps(
            {"error": 'Usage: get_tiuli_trail.py "<trail name>" | --url "<tiuli URL>"'},
            ensure_ascii=False
        ))
        sys.exit(1)

    try:
        if args[0] == "--url" and len(args) >= 2:
            result = fetch_by_url(args[1])
        else:
            result = fetch_by_name(args[0])

        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(1 if "error" in result else 0)
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
