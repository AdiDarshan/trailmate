import { describe, expect, it } from "vitest";
import { addDaysISO, dayDate, dayOnDate, israelToday } from "./reminder.helpers";
import type { Day } from "../../shared/types";

describe("israelToday", () => {
  it("formats as YYYY-MM-DD in Asia/Jerusalem", () => {
    // 23:30 UTC on Jan 1 is already Jan 2 in Israel (UTC+2).
    expect(israelToday(new Date("2026-01-01T23:30:00Z"))).toBe("2026-01-02");
    // Midday UTC is the same calendar day.
    expect(israelToday(new Date("2026-06-15T12:00:00Z"))).toBe("2026-06-15");
  });
});

describe("addDaysISO", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDaysISO("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-03-10", 0)).toBe("2026-03-10");
  });
});

describe("dayDate", () => {
  it("maps day_number to the real calendar date (1-based)", () => {
    expect(dayDate("2026-07-11", 1)).toBe("2026-07-11");
    expect(dayDate("2026-07-11", 3)).toBe("2026-07-13");
  });

  it("clamps nonsense day numbers instead of going backwards", () => {
    expect(dayDate("2026-07-11", 0)).toBe("2026-07-11");
    expect(dayDate("2026-07-11", -5)).toBe("2026-07-11");
  });
});

describe("dayOnDate", () => {
  const days = [
    { day_number: 1, date: "Sat" },
    { day_number: 2, date: "Sun" },
  ] as Day[];

  it("finds the trip day falling on the target date", () => {
    expect(dayOnDate(days, "2026-07-11", "2026-07-12")?.day_number).toBe(2);
  });

  it("returns undefined when no day matches", () => {
    expect(dayOnDate(days, "2026-07-11", "2026-07-20")).toBeUndefined();
    expect(dayOnDate([], "2026-07-11", "2026-07-11")).toBeUndefined();
  });
});
