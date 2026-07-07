import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatForecast, parseStartDate, weatherService } from "./weather.service";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseStartDate", () => {
  it("accepts YYYY-MM-DD and defaults to today when omitted", () => {
    expect(parseStartDate("2026-08-01").toISOString()).toContain("2026-08-01");
    expect(parseStartDate()).toBeInstanceOf(Date);
  });

  it("regression: garbage dates throw a clear error, not 'Invalid time value'", () => {
    expect(() => parseStartDate("next Saturday")).toThrow('Invalid date: "next Saturday"');
  });
});

describe("formatForecast (pure)", () => {
  const raw = {
    daily: {
      time: ["2026-08-01", "2026-08-02"],
      temperature_2m_max: [36, 24],
      temperature_2m_min: [22, 15],
      precipitation_sum: [0, 2],
      weathercode: [0, 63],
      windspeed_10m_max: [10, 55],
    },
  };

  it("maps WMO codes and emits threshold-based advice", () => {
    const out = formatForecast(raw, "Tel Aviv", 32, 34.8, false);
    expect(out.forecast).toHaveLength(2);
    expect(out.forecast[0].condition).toBe("Clear sky");
    expect(out.forecast[0].advice.join()).toContain("Very hot"); // 36 > 33
    expect(out.forecast[1].advice.join()).toContain("Rain expected"); // code 63
    expect(out.forecast[1].advice.join()).toContain("Strong winds"); // 55 > 40
    expect(out.historical).toBe(false);
  });

  it("gives 'good conditions' advice when nothing triggers", () => {
    const calm = { daily: { time: ["2026-05-01"], temperature_2m_max: [25], weathercode: [1], windspeed_10m_max: [12] } };
    expect(formatForecast(calm, "X", 0, 0, true).forecast[0].advice).toEqual(["Good conditions for hiking"]);
  });

  it("survives a malformed API response (no daily block)", () => {
    expect(formatForecast({}, "X", 0, 0, false).forecast).toEqual([]);
  });
});

describe("weatherService.forecast", () => {
  it("geocodes then fetches, returning a formatted forecast", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("nominatim")) {
        return { ok: true, json: async () => [{ lat: "32.79", lon: "35.53", display_name: "Tiberias, Israel" }] } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          daily: { time: ["2026-07-08"], temperature_2m_max: [30], temperature_2m_min: [20], precipitation_sum: [0], weathercode: [1], windspeed_10m_max: [8] },
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await weatherService.forecast("Tiberias");
    expect(out.location).toBe("Tiberias, Israel");
    expect(out.forecast[0].condition).toBe("Mainly clear");
  });

  it("throws a descriptive error when the location can't be geocoded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] }) as Response));
    await expect(weatherService.forecast("Atlantis")).rejects.toThrow("Could not find location: Atlantis");
  });

  it("throws when location is missing", async () => {
    await expect(weatherService.forecast("")).rejects.toThrow("location is required");
  });
});
