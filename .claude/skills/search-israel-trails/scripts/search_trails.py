#!/usr/bin/env python3
"""Three-API trail search for Israel Hiking Map.

Usage:
    python search_trails.py <query> [--max N] [--language en|he]

Exits 0 and prints JSON array of trail objects on success.
Exits 1 and prints {"error": "..."} on failure.
"""

from __future__ import annotations

import json
import math
import sys
import urllib.parse
import urllib.request
import urllib.error

DEFAULT_MAX = 3
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
IHM_BASE = "https://israelhiking.osm.org.il/api"
TIMEOUT = 20


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def get_json(url: str) -> object:
    with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def post_json(url: str, body: str) -> object:
    data = body.encode()
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


# ── Step 1: IHM search ───────────────────────────────────────────────────────

def ihm_search(query: str, language: str, max_results: int) -> list[dict]:
    encoded = urllib.parse.quote(query)
    url = f"{IHM_BASE}/search/{encoded}?language={language}"
    results = get_json(url)
    return [r for r in results if "hike" in r.get("icon", "")][:max_results]


# ── Step 2: Overpass tag enrichment ──────────────────────────────────────────

def overpass_tags(rel_id: str) -> dict:
    data = f"[out:json];relation({rel_id});out tags;"
    resp = post_json(OVERPASS_URL, data)
    elements = resp.get("elements", [])
    return elements[0].get("tags", {}) if elements else {}


def parse_color(osmc_symbol: str) -> str:
    known = {"red", "blue", "green", "black", "orange", "white", "yellow"}
    for part in osmc_symbol.split(":"):
        word = part.split("_")[0]
        if word in known:
            return word
    return ""


# ── Step 3a: Overpass geometry ────────────────────────────────────────────────

def overpass_geometry(rel_id: str) -> list[tuple[float, float]]:
    data = f"[out:json];relation({rel_id});way(r);out geom;"
    resp = post_json(OVERPASS_URL, data)
    coords = []
    for way in resp.get("elements", []):
        for node in way.get("geometry", []):
            coords.append((node["lat"], node["lon"]))
    return coords


# ── Step 3b: Haversine distance ───────────────────────────────────────────────

def haversine(p1: tuple[float, float], p2: tuple[float, float]) -> float:
    R = 6_371_000
    lat1, lon1 = math.radians(p1[0]), math.radians(p1[1])
    lat2, lon2 = math.radians(p2[0]), math.radians(p2[1])
    a = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def total_distance_km(coords: list[tuple[float, float]]) -> float:
    total = sum(haversine(coords[i], coords[i + 1]) for i in range(len(coords) - 1))
    return round(total / 1000, 1)


# ── Step 3c: IHM elevation ────────────────────────────────────────────────────

def elevation_gain(coords: list[tuple[float, float]]) -> float:
    step = max(1, len(coords) // 20)
    sample = coords[::step][:20]
    points_param = "|".join(f"{lat},{lon}" for lat, lon in sample)
    url = f"{IHM_BASE}/elevation?points={urllib.parse.quote(points_param)}"
    elevs = get_json(url)
    return round(sum(max(0.0, elevs[i + 1] - elevs[i]) for i in range(len(elevs) - 1)))


# ── Step 3d: Difficulty ───────────────────────────────────────────────────────

def classify_difficulty(distance_km: float, gain_m: float) -> str:
    score = distance_km + gain_m / 100
    if score < 5:
        return "easy"
    elif score < 15:
        return "moderate"
    return "hard"


# ── Main flow ─────────────────────────────────────────────────────────────────

def enrich(trail: dict) -> dict:
    info: dict = {
        "name": trail.get("title"),
        "display_name": trail.get("displayName"),
        "location": trail.get("location"),
    }

    osm_id = trail.get("id", "")
    if not osm_id.startswith("relation_"):
        return info

    rel_id = osm_id.replace("relation_", "")

    # Step 2: tags
    try:
        tags = overpass_tags(rel_id)
        color = parse_color(tags.get("osmc:symbol", ""))
        if color:
            info["trail_color"] = color
        network_map = {"lwn": "local", "rwn": "regional", "nwn": "national"}
        if tags.get("network"):
            info["network"] = network_map.get(tags["network"], tags["network"])
        if tags.get("ref"):
            info["ref"] = tags["ref"]
        if tags.get("description"):
            info["description"] = tags["description"]
        if tags.get("distance"):
            try:
                info["distance_km"] = float(tags["distance"].replace("km", "").strip())
            except ValueError:
                pass
    except Exception:
        pass

    # Step 3: geometry + elevation (only if distance not already known)
    if "distance_km" not in info:
        try:
            coords = overpass_geometry(rel_id)
            if len(coords) >= 2:
                dist = total_distance_km(coords)
                info["distance_km"] = dist
                gain = elevation_gain(coords)
                info["elevation_gain_m"] = gain
                info["difficulty"] = classify_difficulty(dist, gain)
        except Exception:
            pass

    return info


def search(query: str, language: str = "en", max_results: int = DEFAULT_MAX) -> list[dict]:
    trails = ihm_search(query, language, max_results)
    if not trails:
        return []
    return [enrich(t) for t in trails]


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"error": "Usage: search_trails.py <query> [--max N] [--language en|he]"}))
        sys.exit(1)

    query = args[0]
    max_results = DEFAULT_MAX
    language = "en"

    i = 1
    while i < len(args):
        if args[i] == "--max" and i + 1 < len(args):
            max_results = min(int(args[i + 1]), 5)
            i += 2
        elif args[i] == "--language" and i + 1 < len(args):
            language = args[i + 1]
            i += 2
        else:
            i += 1

    try:
        results = search(query, language, max_results)
        print(json.dumps(results, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
