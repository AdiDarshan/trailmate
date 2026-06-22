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
import time
import urllib.parse
import urllib.request
import urllib.error

DEFAULT_MAX = 3
DEFAULT_MAX_KM = 30  # flag routes longer than this as long_distance_route
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
IHM_BASE = "https://israelhiking.osm.org.il/api"
TIMEOUT = 20
ROUTING_TIMEOUT = 10   # routing API is fast; fail quickly and fall back
ROUTING_MIN_GAP = 0.5  # seconds between routing calls — respect IHM rate limit


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def get_json(url: str) -> object:
    with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def post_json(url: str, body: str) -> object:
    # Overpass API expects form-encoded body: data=<query>
    encoded = urllib.parse.urlencode({"data": body}).encode()
    req = urllib.request.Request(url, data=encoded, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("User-Agent", "TrailMate/1.0 (travel planning)")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


# ── IHM Routing API ──────────────────────────────────────────────────────────

def routing_distance_and_elevation(
    start: tuple[float, float],
    end: tuple[float, float],
) -> dict | None:
    """Call IHM's routing API between two WGS84 points and return accurate metrics.

    Returns a dict with ``distance_km``, ``elevation_gain_m``, ``elevation_loss_m``
    on success, or ``None`` if the call fails or the route is degenerate.

    The routing engine follows actual hiking paths, so the distance is the
    real walking distance — not the sum of unsorted geometry segments.
    """
    # Skip routing when start ≈ end (loop trail whose geometry gave us the
    # same first/last point) — the router would return near-zero distance.
    if haversine(start, end) < 200:
        return None

    url = (
        f"{IHM_BASE}/routing"
        f"?from={start[0]},{start[1]}"
        f"&to={end[0]},{end[1]}"
        f"&type=Hike"
    )
    try:
        with urllib.request.urlopen(url, timeout=ROUTING_TIMEOUT) as r:
            data = json.loads(r.read().decode())
    except Exception:
        return None

    features = data.get("features", [])
    if not features:
        return None

    # Coordinates are [lng, lat, elevation]
    coords = features[0].get("geometry", {}).get("coordinates", [])
    if len(coords) < 2:
        return None

    # Distance: sum consecutive haversine distances on the ROUTED path
    dist_m = sum(
        haversine((coords[i][1], coords[i][0]), (coords[i + 1][1], coords[i + 1][0]))
        for i in range(len(coords) - 1)
    )
    dist_km = round(dist_m / 1000, 1)
    if dist_km == 0:
        return None

    # Elevation: cumulative gain and loss from per-point elevations
    elevations = [c[2] for c in coords if len(c) > 2 and c[2] is not None]
    gain = loss = 0
    for i in range(1, len(elevations)):
        diff = elevations[i] - elevations[i - 1]
        if diff > 0:
            gain += diff
        else:
            loss += abs(diff)

    return {
        "distance_km": dist_km,
        "elevation_gain_m": round(gain),
        "elevation_loss_m": round(loss),
    }


# ── Step 1: IHM search ───────────────────────────────────────────────────────

def ihm_search(query: str, language: str, max_results: int) -> list[dict]:
    encoded = urllib.parse.quote(query)
    url = f"{IHM_BASE}/search/{encoded}?language={language}"
    results = get_json(url)
    # Only keep results that are OSM relations — these are named trail routes.
    # way_ results are often short footpaths or streets; node_ results are
    # POIs/localities that can't be enriched with geometry or trail tags.
    return [
        r for r in results
        if "hike" in r.get("icon", "") and r.get("id", "").startswith("relation_")
    ][:max_results]


# ── Step 2: Overpass tag enrichment ──────────────────────────────────────────

def overpass_tags(osm_type: str, osm_id: str) -> dict:
    """Fetch OSM tags for a relation or way."""
    if osm_type == "relation":
        data = f"[out:json];relation({osm_id});out tags;"
    else:
        data = f"[out:json];way({osm_id});out tags;"
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

def overpass_geometry(osm_type: str, osm_id: str) -> list[tuple[float, float]]:
    """Fetch ordered coordinates for a relation or way."""
    coords = []
    if osm_type == "relation":
        data = f"[out:json];relation({osm_id});way(r);out geom;"
        resp = post_json(OVERPASS_URL, data)
        for way in resp.get("elements", []):
            for node in way.get("geometry", []):
                coords.append((node["lat"], node["lon"]))
    else:
        data = f"[out:json];way({osm_id});out geom;"
        resp = post_json(OVERPASS_URL, data)
        for element in resp.get("elements", []):
            for node in element.get("geometry", []):
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

def elevation_profile(coords: list[tuple[float, float]]) -> tuple[float, float]:
    """Return (gain_m, loss_m) from sampled elevation data."""
    step = max(1, len(coords) // 20)
    sample = coords[::step][:20]
    points_param = "|".join(f"{lat},{lon}" for lat, lon in sample)
    url = f"{IHM_BASE}/elevation?points={urllib.parse.quote(points_param)}"
    elevs = get_json(url)
    gain = round(sum(max(0.0, elevs[i + 1] - elevs[i]) for i in range(len(elevs) - 1)))
    loss = round(sum(max(0.0, elevs[i] - elevs[i + 1]) for i in range(len(elevs) - 1)))
    return gain, loss


# ── Step 3d: Difficulty ───────────────────────────────────────────────────────

def classify_difficulty(distance_km: float, gain_m: float) -> str:
    score = distance_km + gain_m / 100
    if score < 5:
        return "easy"
    elif score < 15:
        return "moderate"
    return "hard"


# ── Step 3e: Duration estimate (Naismith's rule) ─────────────────────────────

def estimate_duration(distance_km: float, gain_m: float) -> str:
    """Naismith: 4 km/h walking pace + 1 h per 600 m ascent."""
    hours_raw = distance_km / 4.0 + gain_m / 600.0
    # Round to nearest half-hour
    half_hours = round(hours_raw * 2)
    hours = half_hours // 2
    mins = 30 if half_hours % 2 else 0
    if hours == 0:
        return f"{mins or 30} min"
    if mins:
        return f"{hours}h {mins}min"
    return f"{hours}h"


# ── Step 3f: Car logistics ────────────────────────────────────────────────────

def car_logistics(tags: dict, coords: list[tuple[float, float]]) -> str:
    """Determine whether the trail is a loop (1 car) or linear (2 cars/shuttle)."""
    roundtrip = tags.get("roundtrip", "").lower()
    if roundtrip == "yes":
        return "loop — 1 car"
    if roundtrip == "no":
        return "linear — 2 cars or shuttle"
    # Heuristic: if first and last coordinate are within 500 m, treat as loop
    if len(coords) >= 2 and haversine(coords[0], coords[-1]) < 500:
        return "loop — 1 car"
    if coords:
        return "linear — 2 cars or shuttle"
    return "unknown"


# ── Main flow ─────────────────────────────────────────────────────────────────

def enrich(trail: dict) -> dict:
    info: dict = {
        "name": trail.get("title"),
        "display_name": trail.get("displayName"),
        "location": trail.get("location"),
    }

    raw_id = trail.get("id", "")
    if raw_id.startswith("relation_"):
        osm_type, osm_id = "relation", raw_id.replace("relation_", "")
    elif raw_id.startswith("way_"):
        osm_type, osm_id = "way", raw_id.replace("way_", "")
    else:
        return info  # node or unknown — not enrichable via Overpass

    tags: dict = {}

    # Step 2: tags
    try:
        tags = overpass_tags(osm_type, osm_id)
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
        # Start / end named locations
        if tags.get("from"):
            info["trailhead_from"] = tags["from"]
        if tags.get("to"):
            info["trailhead_to"] = tags["to"]
        # Distance from tag
        if tags.get("distance"):
            try:
                info["distance_km"] = float(tags["distance"].replace("km", "").strip())
            except ValueError:
                pass
        # Elevation from tags (more reliable than computed when present)
        if tags.get("ascent"):
            try:
                info["elevation_gain_m"] = int(tags["ascent"])
            except ValueError:
                pass
        if tags.get("descent"):
            try:
                info["elevation_loss_m"] = int(tags["descent"])
            except ValueError:
                pass
        if tags.get("operator"):
            info["operator"] = tags["operator"]
        if tags.get("website") or tags.get("url"):
            info["website"] = tags.get("website") or tags.get("url")
    except Exception:
        pass

    # Step 3: geometry — used only for trailhead coords and loop detection.
    coords: list[tuple[float, float]] = []
    try:
        coords = overpass_geometry(osm_type, osm_id)
        if coords:
            info["trailhead_coords"] = {"lat": round(coords[0][0], 6), "lng": round(coords[0][1], 6)}
    except Exception:
        pass

    # Step 4: accurate distance + elevation via IHM routing API.
    # Routing follows actual hiking paths, so it avoids the inflated sums
    # produced by concatenating unsorted OSM relation member ways.
    # Only runs when tags didn't already supply a distance value.
    routed = None
    if "distance_km" not in info and len(coords) >= 2:
        try:
            time.sleep(ROUTING_MIN_GAP)
            routed = routing_distance_and_elevation(coords[0], coords[-1])
        except Exception:
            pass

    if routed:
        info["distance_km"]     = routed["distance_km"]
        info["elevation_gain_m"] = routed["elevation_gain_m"]
        info["elevation_loss_m"] = routed["elevation_loss_m"]
    else:
        # Fallback: geometry-based calculation (less accurate for complex relations)
        if "distance_km" not in info and len(coords) >= 2:
            info["distance_km"] = total_distance_km(coords)
        if ("elevation_gain_m" not in info or "elevation_loss_m" not in info) and len(coords) >= 2:
            try:
                gain_fb, loss_fb = elevation_profile(coords)
                if "elevation_gain_m" not in info:
                    info["elevation_gain_m"] = gain_fb
                if "elevation_loss_m" not in info:
                    info["elevation_loss_m"] = loss_fb
            except Exception:
                pass

    # Derived fields
    dist = info.get("distance_km", 0)
    gain = info.get("elevation_gain_m", 0)

    if dist:
        if "difficulty" not in info:
            info["difficulty"] = classify_difficulty(dist, gain)
        info["estimated_duration"] = estimate_duration(dist, gain)

    info["car_logistics"] = car_logistics(tags, coords)

    return info


def search(
    query: str,
    language: str = "en",
    max_results: int = DEFAULT_MAX,
    max_km: float = DEFAULT_MAX_KM,
) -> list[dict]:
    trails = ihm_search(query, language, max_results)
    if not trails:
        return []
    enriched = [enrich(t) for t in trails]
    for t in enriched:
        dist = t.get("distance_km", 0)
        if dist > max_km:
            # OSM geometry for a regional/national trail relation sums ALL member
            # ways regardless of order, producing inflated distances (e.g. 481 km).
            # Flag it so callers know to suppress the numbers and rely on tiuli.
            t["long_distance_route"] = True
            t.pop("distance_km", None)
            t.pop("estimated_duration", None)
    return enriched


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"error": "Usage: search_trails.py <query> [--max N] [--language en|he]"}))
        sys.exit(1)

    query = args[0]
    max_results = DEFAULT_MAX
    max_km = DEFAULT_MAX_KM
    language = "en"

    i = 1
    while i < len(args):
        if args[i] == "--max" and i + 1 < len(args):
            max_results = min(int(args[i + 1]), 5)
            i += 2
        elif args[i] == "--max-km" and i + 1 < len(args):
            max_km = float(args[i + 1])
            i += 2
        elif args[i] == "--language" and i + 1 < len(args):
            language = args[i + 1]
            i += 2
        else:
            i += 1

    try:
        results = search(query, language, max_results, max_km)
        print(json.dumps(results, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
