#!/usr/bin/env python3
"""Build the Nakeb trail catalog seed (mirrors enrich_tiuli.py).

Flow:
  1. Read nakeb.co.il/sitemap.xml → the list of /hike/{id} trail URLs.
  2. Fetch + parse each page (parse_nakeb_page) in a thread pool.
  3. Tag each trail's region by k-NN against the Tiuli catalog (trails_seed.json),
     which already carries region_he + coordinates for 348 trails.
  4. Write .agents/data/nakeb_seed.json (same schema as trails_seed.json, +source).

Usage:
    python scripts/enrich_nakeb.py --validate      # k-NN accuracy check only (no scrape)
    python scripts/enrich_nakeb.py [--workers 16]  # full scrape → seed
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from nakeb_parser import parse_nakeb_page  # noqa: E402

NAKEB_BASE = "https://www.nakeb.co.il"
SITEMAP = f"{NAKEB_BASE}/sitemap.xml"
TIMEOUT = 20
_ROOT = Path(__file__).parent.parent
TIULI_SEED = _ROOT / ".agents" / "data" / "trails_seed.json"
OUT_PATH = _ROOT / ".agents" / "data" / "nakeb_seed.json"

# k-NN region tagging params (used only as a fallback for area now).
K = 5
MAX_KM = 30.0  # if the nearest Tiuli trail is farther than this, leave region null

# Map Nakeb's own region_he → our 4 areas by toponym, mirroring Tiuli's convention
# (Galilee/Golan/Carmel → North; Negev/Dead Sea/Eilat → South; Sharon/Samaria/
# Shephelah/Gush Dan → Center; Jerusalem → Jerusalem). This is authoritative and
# consistent per region — unlike the k-NN guess, which split a single region across
# areas. First matching group wins; Jerusalem is checked first.
AREA_BY_TOPONYM: list[tuple[tuple[str, ...], str, str]] = [
    (("ירושלים",), "ירושלים והסביבה", "Jerusalem"),
    (("גליל", "גולן", "חרמון", "כרמל", "גלבוע", "עמקים", "מנשה"), "צפון", "North"),
    (("נגב", "ערבה", "אילת", "מכתש", "פארן", "תמנע", "מדבר יהודה", "ים המלח", "חולות"),
     "דרום", "South"),
    (("שרון", "שומרון", "גוש דן", "שפלה", "פלשת", "בקעת הירדן", "מודיעין"), "מרכז", "Center"),
]


def area_from_region(region_he: str) -> tuple[str, str] | None:
    """(area_he, area_en) from a Nakeb region string by toponym, or None if unknown."""
    for toponyms, area_he, area_en in AREA_BY_TOPONYM:
        if any(t in region_he for t in toponyms):
            return area_he, area_en
    return None

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept-Language": "he-IL,he;q=0.9"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read().decode("utf-8", errors="replace")


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in km."""
    r = math.radians
    a = (
        math.sin(r(lat2 - lat1) / 2) ** 2
        + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lng2 - lng1) / 2) ** 2
    )
    return 6371.0 * 2 * math.asin(math.sqrt(a))


# ── k-NN region tagging against the Tiuli catalog ─────────────────────────────

def load_reference() -> list[dict]:
    """Tiuli trails with coordinates + region, as the k-NN reference set."""
    data = json.loads(TIULI_SEED.read_text(encoding="utf-8"))
    return [
        {"lat": r["lat"], "lng": r["lng"], "region_he": r.get("region_he", ""),
         "area_he": r.get("area_he", ""), "area_en": r.get("area_en", "")}
        for r in data
        if r.get("lat") and r.get("lng") and r.get("region_he")
    ]


def tag_region(lat: float, lng: float, ref: list[dict], k: int = K, max_km: float = MAX_KM) -> dict:
    """Majority region of the k nearest Tiuli trails; null if none within max_km."""
    nearest = sorted(ref, key=lambda t: haversine(lat, lng, t["lat"], t["lng"]))[:k]
    if not nearest or haversine(lat, lng, nearest[0]["lat"], nearest[0]["lng"]) > max_km:
        return {"region_he": "", "area_he": "", "area_en": ""}
    winner = collections.Counter(t["region_he"] for t in nearest).most_common(1)[0][0]
    match = next(t for t in nearest if t["region_he"] == winner)
    return {"region_he": winner, "area_he": match["area_he"], "area_en": match["area_en"]}


def validate(ref: list[dict], k: int = K) -> None:
    """Leave-one-out accuracy. `area_he` is what k-NN authoritatively provides for
    Nakeb (region_he comes from Nakeb's own keyword); region shown for reference."""
    area_ok = region_ok = 0
    for i, t in enumerate(ref):
        others = ref[:i] + ref[i + 1:]
        tag = tag_region(t["lat"], t["lng"], others, k=k)
        area_ok += tag["area_he"] == t["area_he"]
        region_ok += tag["region_he"] == t["region_he"]
    n = len(ref)
    print(
        f"k-NN leave-one-out (k={k}): "
        f"AREA {area_ok}/{n} = {100 * area_ok / n:.1f}%  |  "
        f"region(fallback) {region_ok}/{n} = {100 * region_ok / n:.1f}%",
        file=sys.stderr,
    )


# ── Scrape one trail ──────────────────────────────────────────────────────────

def enrich_one(hike_id: str, ref: list[dict]) -> dict | None:
    url = f"{NAKEB_BASE}/hike/{hike_id}"
    try:
        rec = parse_nakeb_page(fetch(url), url)
    except Exception as e:  # noqa: BLE001 — record failure, keep going
        return {"id": hike_id, "url": url, "source": "nakeb", "_error": str(e)}
    rec["id"] = f"nakeb-{hike_id}"
    # Area: prefer a deterministic map from Nakeb's own region (authoritative +
    # consistent per region); fall back to k-NN only when the region is unknown/junk.
    area = area_from_region(rec.get("region_he", ""))
    if area:
        rec["area_he"], rec["area_en"] = area
    elif rec.get("lat") and rec.get("lng"):
        knn = tag_region(rec["lat"], rec["lng"], ref)
        rec["area_he"], rec["area_en"] = knn["area_he"], knn["area_en"]
        if not rec.get("region_he"):
            rec["region_he"] = knn["region_he"]
    return rec


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--validate", action="store_true", help="run k-NN accuracy check and exit")
    args = parser.parse_args()

    ref = load_reference()
    print(f"Reference set: {len(ref)} Tiuli trails with region + coords", file=sys.stderr)
    validate(ref)
    if args.validate:
        return

    ids = sorted(set(re.findall(r"/hike/(\d+)", fetch(SITEMAP))), key=int)
    print(f"Enriching {len(ids)} Nakeb trails with {args.workers} workers…", file=sys.stderr)

    results: list[dict] = []
    start = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(enrich_one, i, ref): i for i in ids}
        done = 0
        for fut in as_completed(futures):
            done += 1
            if done % 50 == 0:
                print(f"  {done}/{len(ids)}", file=sys.stderr)
            r = fut.result()
            if r:
                results.append(r)

    results.sort(key=lambda x: int(x["id"].split("-")[-1]))
    OUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    n = len(results)
    def have(key: str) -> int:
        return sum(1 for r in results if r.get(key))
    errors = sum(1 for r in results if "_error" in r)
    coords = sum(1 for r in results if r.get("lat") and r.get("lng"))
    feats = sum(1 for r in results if r.get("features"))
    print(f"\nDone: {n} records in {time.time() - start:.1f}s → {OUT_PATH}", file=sys.stderr)
    print("Coverage:", file=sys.stderr)
    for label, val in [
        ("errors", errors), ("name", have("name_he")), ("description", have("description_he")),
        ("difficulty_level", have("difficulty_level")), ("distance_km", have("distance_km")),
        ("coords", coords), ("region", have("region_he")), ("seasons", have("seasons")),
        ("features", feats),
    ]:
        print(f"  {label:16} {val}/{n}", file=sys.stderr)


if __name__ == "__main__":
    main()
