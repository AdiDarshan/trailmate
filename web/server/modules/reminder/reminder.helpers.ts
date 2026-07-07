// Pure date logic for the reminder scheduler — no I/O, fully unit-testable.
// All dates are ISO YYYY-MM-DD strings; "today" is Israel time because the
// cron runs in UTC but trips happen in Asia/Jerusalem.

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
