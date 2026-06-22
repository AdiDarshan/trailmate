#!/usr/bin/env python3
"""One-time scraper: builds a local name→URL index for tiuli.com trails.

Scans track IDs 1–MAX_ID in parallel, extracts name + slug, and writes
the result to DATA_PATH. Run this once (or occasionally to refresh).

Usage:
    python build_tiuli_index.py [--max-id 600] [--workers 20]

Output:
    .agents/data/tiuli_index.json
    Format: [{"id": 25, "name": "מערת אצבע...", "slug": "מערת-אצבע...", "url": "https://..."}, ...]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

MAX_ID = 600
WORKERS = 20
TIMEOUT = 10
TIULI_BASE = "https://www.tiuli.com"
DATA_PATH = Path(__file__).parent.parent.parent.parent.parent / ".agents" / "data" / "tiuli_index.json"


def fetch_track_meta(track_id: int) -> dict | None:
    """Fetch one track page and extract name + slug. Returns None on 404/error."""
    url = f"{TIULI_BASE}/tracks/{track_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            # Follow redirect to get the canonical slug URL
            final_url = r.url
            html = r.read().decode("utf-8")
    except Exception:
        return None

    # If redirected away from /tracks/ it's a 404 or non-trail page
    if "/tracks/" not in final_url:
        return None

    title = re.search(r"<title>([^<]+)</title>", html)
    if not title:
        return None

    # Title format: "שם ראשי - שם משני - אזור - אתר למטייל"
    # We want "שם ראשי - שם משני" (up to the region/site suffix)
    title_parts = title.group(1).split(" - ")
    # Drop the last two parts (region name + "אתר למטייל" / "למטייל בישראל")
    name_parts = [p.strip() for p in title_parts[:-2]] if len(title_parts) > 2 else [title_parts[0].strip()]
    name = " - ".join(name_parts).strip()

    # Skip generic/error pages
    if len(name) < 3 or ("טיולי" in name and len(name) < 10):
        return None

    # OG description often contains the full subtitle with sub-trail names
    og_desc = re.search(r'property="og:description"[^>]+content="([^"]+)"', html)
    # Extract the "about X" part: "...כל המידע על X - איך מגיעים..."
    subtitle = ""
    if og_desc:
        m = re.search(r"המידע על ([^–\-]+?) -\s*(?:איך|נחל|שמורת|מסלול|הר|)", og_desc.group(1))
        if m:
            subtitle = m.group(1).strip()

    # Extract slug from final URL
    slug_match = re.search(r"/tracks/\d+/([^?#]+)", final_url)
    slug = slug_match.group(1) if slug_match else ""

    return {
        "id": track_id,
        "name": name,
        "subtitle": subtitle,   # may include sub-trail names like "נחל ערוגות"
        "slug": slug,
        "url": final_url,
    }


def build_index(max_id: int, workers: int) -> list[dict]:
    results = []
    print(f"Scanning IDs 1–{max_id} with {workers} workers…", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(fetch_track_meta, i): i for i in range(1, max_id + 1)}
        done = 0
        for future in as_completed(futures):
            done += 1
            if done % 50 == 0:
                print(f"  {done}/{max_id} scanned, {len(results)} found", file=sys.stderr)
            meta = future.result()
            if meta:
                results.append(meta)
    results.sort(key=lambda x: x["id"])
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Build tiuli.com trail index")
    parser.add_argument("--max-id", type=int, default=MAX_ID)
    parser.add_argument("--workers", type=int, default=WORKERS)
    args = parser.parse_args()

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)

    start = time.time()
    index = build_index(args.max_id, args.workers)
    elapsed = time.time() - start

    DATA_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Done: {len(index)} trails indexed in {elapsed:.1f}s → {DATA_PATH}", file=sys.stderr)
    print(json.dumps({"status": "success", "count": len(index), "path": str(DATA_PATH)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
