#!/usr/bin/env python3
"""Phase 0 — one-time enrichment of the tiuli trail catalog.

Reads the name→URL index (.agents/data/tiuli_index.json), fetches every
trail page, parses the full editorial detail with the existing
``parse_tiuli_page`` logic, and writes a single complete seed file that
will be loaded into Supabase.

Output: .agents/data/trails_seed.json  — a list of fully-enriched records:
    {
      "id", "name_he", "subtitle", "slug", "url",
      "description_he", "waze_link", "lat", "lng",
      "difficulty", "duration", "trail_map_image"
    }

Usage:
    python scripts/enrich_tiuli.py [--workers 16]
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def _clean_text(s: str | None) -> str:
    """Decode HTML entities (e.g. &#039; → ') left over from page scraping."""
    return html.unescape(s) if s else ""


def _clean_duration(dur: str | None) -> str:
    """Drop bogus durations. The page regex sometimes grabs facility hours like
    '24 שעות' / '48 שעות' (open 24h), which are not hike durations. No day-hike
    runs 20+ hours, so treat a leading number ≥ 20 as noise."""
    if not dur:
        return ""
    m = re.match(r"(\d+)", dur)
    if m and int(m.group(1)) >= 20:
        return ""
    return dur

# Reuse the battle-tested fetch + parse logic from the skill script.
_PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_PROJECT_ROOT / ".agents" / "skills" / "fetch-tiuli-trail" / "scripts"))

from get_tiuli_trail import fetch_html, parse_tiuli_page  # noqa: E402

INDEX_PATH = _PROJECT_ROOT / ".agents" / "data" / "tiuli_index.json"
OUT_PATH = _PROJECT_ROOT / ".agents" / "data" / "trails_seed.json"


def enrich_one(entry: dict) -> dict | None:
    """Fetch + parse one trail page, merged with its index metadata."""
    try:
        html = fetch_html(entry["url"])
        parsed = parse_tiuli_page(html, entry["url"])
    except Exception as e:  # noqa: BLE001 — record the failure, keep going
        return {
            "id": entry["id"],
            "name_he": entry.get("name", ""),
            "subtitle": entry.get("subtitle", ""),
            "slug": entry.get("slug", ""),
            "url": entry["url"],
            "_error": str(e),
        }

    coords = parsed.get("trailhead_coords") or {}
    return {
        "id": entry["id"],
        "name_he": _clean_text(parsed.get("name_he") or entry.get("name", "")),
        "subtitle": _clean_text(entry.get("subtitle", "")),
        "slug": entry.get("slug", ""),
        "url": entry["url"],
        "description_he": _clean_text(parsed.get("description_he", "")),
        "waze_link": parsed.get("waze_link", ""),
        "lat": coords.get("lat"),
        "lng": coords.get("lng"),
        "difficulty": parsed.get("difficulty_he", ""),
        "duration": _clean_duration(parsed.get("duration_he", "")),
        "trail_map_image": parsed.get("trail_map_image", ""),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=16)
    args = parser.parse_args()

    index: list[dict] = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    print(f"Enriching {len(index)} trails with {args.workers} workers…", file=sys.stderr)

    results: list[dict] = []
    start = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(enrich_one, e): e for e in index}
        done = 0
        for fut in as_completed(futures):
            done += 1
            if done % 25 == 0:
                print(f"  {done}/{len(index)}", file=sys.stderr)
            r = fut.result()
            if r:
                results.append(r)

    results.sort(key=lambda x: x["id"])
    OUT_PATH.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    # Coverage report
    errors = sum(1 for r in results if "_error" in r)
    have_coords = sum(1 for r in results if r.get("lat") and r.get("lng"))
    have_desc = sum(1 for r in results if r.get("description_he"))
    have_waze = sum(1 for r in results if r.get("waze_link"))
    have_diff = sum(1 for r in results if r.get("difficulty"))
    have_dur = sum(1 for r in results if r.get("duration"))
    elapsed = time.time() - start

    print(f"\nDone: {len(results)} records in {elapsed:.1f}s → {OUT_PATH}", file=sys.stderr)
    print("Coverage:", file=sys.stderr)
    print(f"  errors:       {errors}", file=sys.stderr)
    print(f"  coords:       {have_coords}/{len(results)}", file=sys.stderr)
    print(f"  description:  {have_desc}/{len(results)}", file=sys.stderr)
    print(f"  waze:         {have_waze}/{len(results)}", file=sys.stderr)
    print(f"  difficulty:   {have_diff}/{len(results)}", file=sys.stderr)
    print(f"  duration:     {have_dur}/{len(results)}", file=sys.stderr)


if __name__ == "__main__":
    main()
