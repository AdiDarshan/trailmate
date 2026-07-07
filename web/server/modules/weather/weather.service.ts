// Weather business logic — Open-Meteo forecast / historical proxy. No DB;
// talks to Nominatim (geocode) + Open-Meteo only.
//
// Errors thrown here surface as tool results — their audience is the agent
// (which can rephrase/retry), not the end user, so messages are descriptive.

import { createLogger } from "../../shared/logger";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const DAILY_FIELDS =
  "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max";
const FORECAST_HORIZON_DAYS = 16;
const MS_PER_DAY = 86_400_000;

// Advice thresholds (WMO weather codes: https://open-meteo.com/en/docs)
const RAIN_CODES = [61, 63, 65, 80, 81, 82];
const SNOW_CODES = [71, 73, 75];
const STRONG_WIND_KMH = 40;
const VERY_HOT_C = 33;

const WMO: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Foggy", 48: "Icy fog",
  51: "Light drizzle", 53: "Moderate drizzle", 55: "Heavy drizzle",
  61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
  71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
  80: "Slight showers", 81: "Moderate showers", 82: "Heavy showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail",
};

const UA = { "User-Agent": "TrailMate/1.0 (travel planning agent)" };

const log = createLogger("weather.service");

async function getJson(url: string): Promise<any> {
  return log.timed("http_get", { host: new URL(url).host }, async () => {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  });
}

async function geocode(location: string): Promise<[number, number, string]> {
  const params = new URLSearchParams({
    q: `${location}, Israel`,
    format: "json",
    limit: "1",
    countrycodes: "il",
  });
  const results = await getJson(`${NOMINATIM_URL}?${params}`);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`Could not find location: ${location}`);
  }
  const r = results[0];
  const lat = parseFloat(r.lat);
  const lon = parseFloat(r.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error(`Geocoder returned unusable coordinates for: ${location}`);
  }
  return [lat, lon, r.display_name ?? location];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** Parse a user/agent-supplied trip date. Throws a clear error on garbage
 * input instead of letting `toISOString()` die with "Invalid time value". */
export function parseStartDate(date?: string): Date {
  if (!date) return new Date(isoDate(new Date()));
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD.`);
  }
  return new Date(isoDate(parsed));
}

async function fetchRaw(lat: number, lng: number, start: Date, days: number): Promise<[any, boolean]> {
  const today = new Date(isoDate(new Date()));
  const offset = Math.round((start.getTime() - today.getTime()) / MS_PER_DAY);

  if (offset <= FORECAST_HORIZON_DAYS) {
    const forecastDays = Math.min(Math.max(offset + days, days), FORECAST_HORIZON_DAYS);
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      daily: DAILY_FIELDS,
      timezone: "Asia/Jerusalem",
      forecast_days: String(forecastDays),
    });
    const raw = await getJson(`${FORECAST_URL}?${params}`);
    const sliceStart = Math.max(0, offset);
    const daily = raw.daily ?? {};
    for (const key of Object.keys(daily)) {
      if (Array.isArray(daily[key])) daily[key] = daily[key].slice(sliceStart, sliceStart + days);
    }
    return [raw, false];
  }

  // Beyond the live horizon → historical proxy: same calendar window, most
  // recent COMPLETED year (skip back further if that window is still ahead).
  let proxyYear = start.getUTCFullYear() - 1;
  const mk = (y: number) => new Date(Date.UTC(y, start.getUTCMonth(), start.getUTCDate()));
  let proxyStart = mk(proxyYear);
  while (proxyStart >= today) {
    proxyYear -= 1;
    proxyStart = mk(proxyYear);
  }
  const proxyEnd = addDays(proxyStart, days - 1);
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: isoDate(proxyStart),
    end_date: isoDate(proxyEnd),
    daily: DAILY_FIELDS,
    timezone: "Asia/Jerusalem",
  });
  const raw = await getJson(`${ARCHIVE_URL}?${params}`);
  const daily = raw.daily ?? {};
  if (Array.isArray(daily.time)) {
    // Relabel proxy rows with the REQUESTED dates so the agent reads them
    // as the trip's days, not last year's.
    daily.time = daily.time.map((_: string, i: number) => isoDate(addDays(start, i)));
  }
  return [raw, true];
}

/** Shape one Open-Meteo response into the tool's forecast payload. Pure. */
export function formatForecast(raw: any, displayName: string, lat: number, lng: number, historical: boolean) {
  const daily = raw?.daily ?? {};
  const dates: string[] = Array.isArray(daily.time) ? daily.time : [];
  const maxT = daily.temperature_2m_max ?? [];
  const minT = daily.temperature_2m_min ?? [];
  const rain = daily.precipitation_sum ?? [];
  const codes = daily.weathercode ?? [];
  const wind = daily.windspeed_10m_max ?? [];

  const out = dates.map((d, i) => {
    const code = codes[i] ?? 0;
    const condition = WMO[code] ?? "Unknown";
    const windKmh = wind[i] ?? 0;
    const tempMax = maxT[i] ?? null;
    const advice: string[] = [];
    if (RAIN_CODES.includes(code)) advice.push("Rain expected — bring waterproof jacket");
    if (SNOW_CODES.includes(code)) advice.push("Snow possible — trails may be closed");
    if (windKmh > STRONG_WIND_KMH) advice.push("Strong winds — avoid exposed ridges");
    if (tempMax !== null && tempMax > VERY_HOT_C) advice.push("Very hot — start hike early, carry extra water");
    if (advice.length === 0) advice.push("Good conditions for hiking");
    return {
      date: d,
      condition,
      temp_max_c: tempMax,
      temp_min_c: minT[i] ?? null,
      rain_mm: rain[i] ?? 0,
      wind_kmh: windKmh,
      advice,
    };
  });

  return { location: displayName, coordinates: { lat, lng }, historical, forecast: out };
}

class WeatherService {
  async forecast(location: string, date?: string, days = 3) {
    if (!location) throw new Error("location is required");
    const d = Math.max(1, Math.min(FORECAST_HORIZON_DAYS, days));
    const start = parseStartDate(date);
    const [lat, lng, name] = await geocode(location);
    const [raw, historical] = await fetchRaw(lat, lng, start, d);
    return formatForecast(raw, name, lat, lng, historical);
  }
}

export const weatherService = new WeatherService();
