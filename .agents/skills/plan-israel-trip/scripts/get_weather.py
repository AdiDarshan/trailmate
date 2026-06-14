#!/usr/bin/env python3
"""Fetch a 7-day weather forecast for any location using Open-Meteo.

Usage:
    python get_weather.py "<location name>"
    python get_weather.py "<location name>" --days N   (1-7, default 3)

Exits 0 and prints a JSON object on success.
Exits 1 and prints {"error": "..."} on failure.

No API key required — Open-Meteo is completely free.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = 15

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


def fetch_forecast(lat: float, lng: float, days: int) -> dict:
    params = urllib.parse.urlencode({
        "latitude": lat,
        "longitude": lng,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max",
        "timezone": "Asia/Jerusalem",
        "forecast_days": days,
    })
    return get_json(f"{OPEN_METEO_URL}?{params}")


def format_forecast(raw: dict, display_name: str, lat: float, lng: float) -> dict:
    daily = raw.get("daily", {})
    dates = daily.get("time", [])
    max_temps = daily.get("temperature_2m_max", [])
    min_temps = daily.get("temperature_2m_min", [])
    rain = daily.get("precipitation_sum", [])
    codes = daily.get("weathercode", [])
    wind = daily.get("windspeed_10m_max", [])

    days_out = []
    for i, date in enumerate(dates):
        condition_code = codes[i] if i < len(codes) else 0
        condition = WMO_CONDITIONS.get(condition_code, "Unknown")
        rain_mm = rain[i] if i < len(rain) else 0

        advice = []
        if condition_code in (61, 63, 65, 80, 81, 82):
            advice.append("Rain expected — bring waterproof jacket")
        if condition_code in (71, 73, 75):
            advice.append("Snow possible — trails may be closed")
        if (wind[i] if i < len(wind) else 0) > 40:
            advice.append("Strong winds — avoid exposed ridges")
        if (max_temps[i] if i < len(max_temps) else 20) > 33:
            advice.append("Very hot — start hike early, carry extra water")
        if not advice:
            advice.append("Good conditions for hiking")

        days_out.append({
            "date": date,
            "condition": condition,
            "temp_max_c": max_temps[i] if i < len(max_temps) else None,
            "temp_min_c": min_temps[i] if i < len(min_temps) else None,
            "rain_mm": rain_mm,
            "wind_kmh": wind[i] if i < len(wind) else None,
            "advice": advice,
        })

    return {
        "location": display_name,
        "coordinates": {"lat": lat, "lng": lng},
        "forecast": days_out,
    }


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(json.dumps({"error": "Usage: get_weather.py <location> [--days N]"}))
        sys.exit(1)

    location = args[0]
    days = 3

    i = 1
    while i < len(args):
        if args[i] == "--days" and i + 1 < len(args):
            days = max(1, min(7, int(args[i + 1])))
            i += 2
        else:
            i += 1

    try:
        lat, lng, display_name = geocode(location)
        time.sleep(1)  # Nominatim rate limit
        raw = fetch_forecast(lat, lng, days)
        result = format_forecast(raw, display_name, lat, lng)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
