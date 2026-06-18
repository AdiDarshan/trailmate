#!/usr/bin/env python3
"""Fetch a weather forecast for any location using Open-Meteo.

Usage:
    python get_weather.py "<location>" [--days N] [--start-date YYYY-MM-DD]

    --days N            Number of days (1-16, default 3)
    --start-date DATE   Trip start date as YYYY-MM-DD. If omitted, starts today.

Behaviour by start date:
    Within 16 days of today  → live forecast (Open-Meteo forecast API)
    Beyond 16 days           → historical proxy: same calendar period last year
                               (Open-Meteo archive API). Output flagged as
                               "historical": true so the agent can communicate
                               the uncertainty to the user.

Exits 0 and prints a JSON object on success.
Exits 1 and prints {"error": "..."} on failure.
No API key required.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
DAILY_FIELDS = "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max"
TIMEOUT = 15
FORECAST_HORIZON = 16  # Open-Meteo free forecast limit

WMO_CONDITIONS = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Icy fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Heavy drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Slight showers", 81: "Moderate showers", 82: "Heavy showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail",
}


def get_json(url: str) -> object:
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "TrailMate/1.0 (travel planning agent)")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def geocode(location: str) -> tuple[float, float, str]:
    """Return (lat, lng, display_name) for the location."""
    params = urllib.parse.urlencode({
        "q": location + ", Israel",
        "format": "json",
        "limit": 1,
        "countrycodes": "il",
    })
    results = get_json(f"{NOMINATIM_URL}?{params}")
    if not results:
        raise ValueError(f"Could not find location: {location}")
    r = results[0]
    return float(r["lat"]), float(r["lon"]), r.get("display_name", location)


def _fetch_raw_forecast(lat: float, lng: float, start: date, days: int) -> tuple[dict, bool]:
    """Return (raw Open-Meteo daily dict, is_historical).

    Uses the live forecast API when start is within FORECAST_HORIZON days of
    today; falls back to the archive API (same calendar period, previous year)
    when start is further out. The caller receives a flag so it can label the
    data accordingly.
    """
    today = date.today()
    offset = (start - today).days

    if offset <= FORECAST_HORIZON:
        # ── Live forecast ────────────────────────────────────────────────────
        # Request enough days to cover the offset + trip length, then slice.
        forecast_days = min(max(offset + days, days), FORECAST_HORIZON)
        params = urllib.parse.urlencode({
            "latitude": lat, "longitude": lng,
            "daily": DAILY_FIELDS,
            "timezone": "Asia/Jerusalem",
            "forecast_days": forecast_days,
        })
        raw = get_json(f"{OPEN_METEO_FORECAST_URL}?{params}")
        # Slice daily arrays so index 0 = start date
        slice_start = max(0, offset)
        daily = raw.get("daily", {})
        for key in list(daily.keys()):
            daily[key] = daily[key][slice_start: slice_start + days]
        return raw, False

    else:
        # ── Historical proxy ─────────────────────────────────────────────────
        # Use the same calendar window from the most recent past year as a
        # climate proxy. Walk back until we find a year where that date is
        # already in the past (handles e.g. "August 2027" when today is
        # June 2026 — year-1 = August 2026 which is still future).
        proxy_year = start.year - 1
        proxy_start = start.replace(year=proxy_year)
        while proxy_start >= today:
            proxy_year -= 1
            proxy_start = start.replace(year=proxy_year)
        proxy_end = proxy_start + timedelta(days=days - 1)
        params = urllib.parse.urlencode({
            "latitude": lat, "longitude": lng,
            "start_date": proxy_start.isoformat(),
            "end_date": proxy_end.isoformat(),
            "daily": DAILY_FIELDS,
            "timezone": "Asia/Jerusalem",
        })
        raw = get_json(f"{OPEN_METEO_ARCHIVE_URL}?{params}")
        # Replace last-year dates with the actual requested trip dates so
        # the assembled itinerary shows the right calendar dates.
        daily = raw.get("daily", {})
        if "time" in daily:
            daily["time"] = [
                (start + timedelta(days=i)).isoformat()
                for i in range(len(daily["time"]))
            ]
        return raw, True


def format_forecast(raw: dict, display_name: str, lat: float, lng: float,
                    is_historical: bool) -> dict:
    daily = raw.get("daily", {})
    dates = daily.get("time", [])
    max_temps = daily.get("temperature_2m_max", [])
    min_temps = daily.get("temperature_2m_min", [])
    rain = daily.get("precipitation_sum", [])
    codes = daily.get("weathercode", [])
    wind = daily.get("windspeed_10m_max", [])

    days_out = []
    for i, d in enumerate(dates):
        condition_code = codes[i] if i < len(codes) else 0
        condition = WMO_CONDITIONS.get(condition_code, "Unknown")
        rain_mm = rain[i] if i < len(rain) else 0
        wind_kmh = wind[i] if i < len(wind) else 0
        temp_max = max_temps[i] if i < len(max_temps) else None

        advice = []
        if condition_code in (61, 63, 65, 80, 81, 82):
            advice.append("Rain expected — bring waterproof jacket")
        if condition_code in (71, 73, 75):
            advice.append("Snow possible — trails may be closed")
        if wind_kmh and wind_kmh > 40:
            advice.append("Strong winds — avoid exposed ridges")
        if temp_max and temp_max > 33:
            advice.append("Very hot — start hike early, carry extra water")
        if not advice:
            advice.append("Good conditions for hiking")

        days_out.append({
            "date": d,
            "condition": condition,
            "temp_max_c": temp_max,
            "temp_min_c": min_temps[i] if i < len(min_temps) else None,
            "rain_mm": rain_mm,
            "wind_kmh": wind_kmh,
            "advice": advice,
        })

    return {
        "location": display_name,
        "coordinates": {"lat": lat, "lng": lng},
        "historical": is_historical,
        "forecast": days_out,
    }


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"error": "Usage: get_weather.py <location> [--days N] [--start-date YYYY-MM-DD]"}))
        sys.exit(1)

    location = args[0]
    days = 3
    start_date: date | None = None

    i = 1
    while i < len(args):
        if args[i] == "--days" and i + 1 < len(args):
            days = max(1, min(16, int(args[i + 1])))
            i += 2
        elif args[i] == "--start-date" and i + 1 < len(args):
            start_date = date.fromisoformat(args[i + 1])
            i += 2
        else:
            i += 1

    if start_date is None:
        start_date = date.today()

    try:
        lat, lng, display_name = geocode(location)
        time.sleep(1)  # Nominatim rate limit
        raw, is_historical = _fetch_raw_forecast(lat, lng, start_date, days)
        result = format_forecast(raw, display_name, lat, lng, is_historical)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
