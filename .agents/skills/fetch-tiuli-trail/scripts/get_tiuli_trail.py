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


# ── Parse tiuli trail page ────────────────────────────────────────────────────

def parse_tiuli_page(html: str, url: str) -> dict[str, Any]:
    result: dict[str, Any] = {"tiuli_url": url}

    # Name from <title>  (format: "שם מסלול - אזור - אתר למטייל")
    title = re.search(r"<title>([^<]+)</title>", html)
    if title:
        result["name_he"] = title.group(1).split(" - ")[0].strip()

    # OG description — editorial intro written by tiuli editors
    desc = re.search(r'property="og:description"[^>]+content="([^"]+)"', html)
    if desc:
        result["description_he"] = desc.group(1).strip()

    # Waze coordinates embedded in the navigation button href
    waze = re.search(
        r'waze\.com/ul\?navigate=yes&(?:amp;)?ll=([0-9.]+),([0-9.]+)', html
    )
    if waze:
        lat, lng = float(waze.group(1)), float(waze.group(2))
        result["waze_link"] = f"https://waze.com/ul?navigate=yes&ll={lat},{lng}"
        result["trailhead_coords"] = {"lat": lat, "lng": lng}

    # Difficulty label
    diff = re.search(r"difficulty=(\d)", html)
    if diff:
        result["difficulty_he"] = DIFFICULTY_MAP.get(diff.group(1), diff.group(1))

    # Duration — prefer range ("3-4 שעות") over single ("3 שעות")
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
