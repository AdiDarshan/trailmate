#!/usr/bin/env python3
"""OpenStreetMap/Overpass place search for Israel travel planning.

Usage:
    python search_places.py "<area>" --type restaurant|hotel|attraction [--max N]

Exits 0 and prints JSON array of place objects on success.
Exits 1 and prints {"error": "..."} on failure.

No API key required — uses free Nominatim + Overpass APIs.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

DEFAULT_MAX = 5
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
TIMEOUT = 25

# OSM tags for each category
TYPE_TAGS = {
    "restaurant": [
        '["amenity"="restaurant"]',
        '["amenity"="cafe"]',
    ],
    "hotel": [
        '["tourism"="hotel"]',
        '["tourism"="hostel"]',
        '["tourism"="guest_house"]',
        '["tourism"="apartment"]',
    ],
    "attraction": [
        '["tourism"="attraction"]',
        '["tourism"="museum"]',
        '["tourism"="viewpoint"]',
        '["tourism"="archaeological_site"]',
        '["historic"="ruins"]',
        '["historic"="archaeological_site"]',
        '["leisure"="nature_reserve"]',
    ],
}

TYPE_EMOJI = {
    "restaurant": "🍽️",
    "hotel": "🏨",
    "attraction": "📍",
}


def get_json(url: str, headers: dict | None = None) -> object:
    req = urllib.request.Request(url, headers=headers or {})
    req.add_header("User-Agent", "TrailMate/1.0 (travel planning agent)")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def post_json(url: str, body: str) -> object:
    req = urllib.request.Request(url, data=body.encode(), method="POST")
    req.add_header("User-Agent", "TrailMate/1.0 (travel planning agent)")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


# ── Step 1: Geocode the area name ─────────────────────────────────────────────

def geocode(area: str) -> tuple[float, float, float, float]:
    """Return (south, west, north, east) bounding box for the area."""
    params = urllib.parse.urlencode({
        "q": area + ", Israel",
        "format": "json",
        "limit": 1,
        "countrycodes": "il",
    })
    results = get_json(f"{NOMINATIM_URL}?{params}")
    if not results:
        raise ValueError(f"Could not find area: {area}")
    r = results[0]
    lat, lon = float(r["lat"]), float(r["lon"])

    # Only trust the bbox when Nominatim found a proper polygon (way/relation).
    # For nodes (points) the bbox is fabricated and often wildly wrong.
    if r.get("osm_type") in ("way", "relation"):
        bbox = r.get("boundingbox", [])
        if len(bbox) == 4:
            s, n, w, e = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
            # Cap to at most ~50 km in each direction to avoid giant regions
            max_delta = 0.45
            if (n - s) <= max_delta * 2 and (e - w) <= max_delta * 2:
                return s, w, n, e

    # For nodes or oversized polygons: use center + sensible radius.
    # ~25 km radius for region names, ~10 km for city names.
    place_rank = r.get("place_rank", 20)
    delta = 0.23 if place_rank <= 12 else 0.10  # region vs city
    return lat - delta, lon - delta, lat + delta, lon + delta


# ── Step 2: Overpass search ───────────────────────────────────────────────────

def overpass_search(bbox: tuple, tags: list[str], max_results: int) -> list[dict]:
    s, w, n, e = bbox
    bbox_str = f"{s},{w},{n},{e}"

    # Build a union of all tag filters for nodes and ways
    parts = []
    for tag in tags:
        parts.append(f'node{tag}({bbox_str});')
        parts.append(f'way{tag}({bbox_str});')

    query = f"[out:json][timeout:{TIMEOUT}];({' '.join(parts)});out center tags {max_results * 3};"
    resp = post_json(OVERPASS_URL, query)
    return resp.get("elements", [])


# ── Step 3: Format results ────────────────────────────────────────────────────

def format_element(el: dict, place_type: str) -> dict | None:
    tags = el.get("tags", {})
    name = tags.get("name") or tags.get("name:en") or tags.get("name:he")
    if not name:
        return None  # skip unnamed places

    result: dict = {"name": name, "type": place_type}

    # Address
    addr_parts = []
    for key in ("addr:street", "addr:housenumber", "addr:city"):
        if v := tags.get(key):
            addr_parts.append(v)
    if addr_parts:
        result["address"] = ", ".join(addr_parts)
    elif city := tags.get("addr:city"):
        result["address"] = city

    # Location
    if "center" in el:
        result["location"] = {"lat": el["center"]["lat"], "lng": el["center"]["lon"]}
    elif el.get("type") == "node":
        result["location"] = {"lat": el["lat"], "lng": el["lon"]}

    # Contact
    if phone := tags.get("phone") or tags.get("contact:phone"):
        result["phone"] = phone
    if website := tags.get("website") or tags.get("contact:website"):
        result["website"] = website

    # Opening hours
    if hours := tags.get("opening_hours"):
        result["opening_hours"] = hours

    # Cuisine (restaurants)
    if place_type == "restaurant" and (cuisine := tags.get("cuisine")):
        result["cuisine"] = cuisine.replace(";", ", ")

    # Description / tourism info
    if desc := tags.get("description") or tags.get("description:en") or tags.get("wikipedia"):
        result["description"] = desc[:200]

    # OSM link
    osm_type = el.get("type", "node")
    osm_id = el.get("id")
    if osm_id:
        result["osm_url"] = f"https://www.openstreetmap.org/{osm_type}/{osm_id}"

    return result


def search_places(area: str, place_type: str, max_results: int) -> list[dict]:
    tags = TYPE_TAGS.get(place_type)
    if not tags:
        raise ValueError(f"Unknown type: {place_type}. Use restaurant, hotel, or attraction.")

    bbox = geocode(area)
    time.sleep(1)  # Nominatim rate limit
    elements = overpass_search(bbox, tags, max_results)

    results = []
    seen = set()
    for el in elements:
        place = format_element(el, place_type)
        if place and place["name"] not in seen:
            seen.add(place["name"])
            results.append(place)
        if len(results) >= max_results:
            break

    return results


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"error": "Usage: search_places.py <area> --type restaurant|hotel|attraction [--max N]"}))
        sys.exit(1)

    area = args[0]
    place_type = "restaurant"
    max_results = DEFAULT_MAX

    i = 1
    while i < len(args):
        if args[i] == "--type" and i + 1 < len(args):
            place_type = args[i + 1]
            i += 2
        elif args[i] == "--max" and i + 1 < len(args):
            max_results = int(args[i + 1])
            i += 2
        else:
            i += 1

    try:
        results = search_places(area, place_type, max_results)
        print(json.dumps(results, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
