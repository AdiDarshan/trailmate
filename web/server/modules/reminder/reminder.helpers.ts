// Pure date logic for the reminder scheduler — no I/O, fully unit-testable.
// All dates are ISO YYYY-MM-DD strings; "today" is Israel time because the
// cron runs in UTC but trips happen in Asia/Jerusalem.

import { ALL_CLEAR_ADVICE } from "../weather/weather.service";
import type { Day } from "../../shared/types";

/** Today's date in Israel as YYYY-MM-DD (en-CA locale formats exactly that). */
export function israelToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Real date of a given day in the trip = start_date + (day_number - 1). */
export function dayDate(startDate: string, dayNumber: number): string {
  return addDaysISO(startDate, Math.max(0, dayNumber - 1));
}

/** The trip day whose real date is `targetIso`, or undefined. */
export function dayOnDate(days: Day[], startDate: string, targetIso: string): Day | undefined {
  return days.find((d) => dayDate(startDate, d.day_number) === targetIso);
}

/** Whole days from `todayIso` until `startIso` (negative once the trip started). */
export function daysUntil(todayIso: string, startIso: string): number {
  const a = new Date(`${todayIso}T00:00:00Z`).getTime();
  const b = new Date(`${startIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Trailhead coordinates from a Google Maps link ("...?q=32.9,35.7"), if any. */
export function coordsFromMapsLink(url?: string | null): { lat: number; lng: number } | null {
  const m = url?.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
}

/** "Day N: hotel" lines for the booking reminder — deduped by hotel name. */
export function tripHotelLines(days: Day[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const d of days) {
    const name = d?.hotel?.name?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    lines.push(`Day ${d.day_number}: ${name}`);
  }
  return lines;
}

// One forecast day as shaped by weather.service's formatForecast.
export interface ForecastDay {
  date: string;
  condition: string;
  temp_max_c: number | null;
  rain_mm: number;
  wind_kmh: number;
  advice: string[];
}

export interface WeatherProblem {
  date: string;
  condition: string;
  issues: string[];
}

/** Forecast days whose advice flags a real problem (rain, snow, wind, heat). */
export function weatherProblems(forecast: ForecastDay[]): WeatherProblem[] {
  return forecast
    .map((f) => ({
      date: f.date,
      condition: f.condition,
      issues: (f.advice ?? []).filter((a) => a !== ALL_CLEAR_ADVICE),
    }))
    .filter((p) => p.issues.length > 0);
}
