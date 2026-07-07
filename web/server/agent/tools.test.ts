// executeTool dispatch: validation → typed executor → structured error
// results. Services are mocked; this tests the boundary, not the services.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../modules/trail/trail.service", () => ({
  trailService: { searchCatalog: vi.fn(), searchOSM: vi.fn() },
}));
vi.mock("../modules/place/place.service", () => ({
  placeService: { search: vi.fn() },
}));
vi.mock("../modules/weather/weather.service", () => ({
  weatherService: { forecast: vi.fn() },
}));

import { executeTool } from "./tools";
import { trailService } from "../modules/trail/trail.service";
import { weatherService } from "../modules/weather/weather.service";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("executeTool", () => {
  it("dispatches search_tiuli with coerced, mapped filters", async () => {
    vi.mocked(trailService.searchCatalog).mockResolvedValue({ trails: [] } as any);
    await executeTool("search_tiuli", { query: "family hike", max_km: "6", limit: "3" });
    expect(trailService.searchCatalog).toHaveBeenCalledWith("family hike", {
      region: undefined,
      maxKm: 6,
      minKm: undefined,
      difficultyMax: undefined,
      features: undefined,
      limit: 3,
    });
  });

  it("applies documented defaults (weather days=3)", async () => {
    vi.mocked(weatherService.forecast).mockResolvedValue({} as any);
    await executeTool("get_weather", { location: "Tel Aviv" });
    expect(weatherService.forecast).toHaveBeenCalledWith("Tel Aviv", undefined, 3);
  });

  it("returns a structured error for an unknown tool", async () => {
    const res = (await executeTool("no_such_tool", {})) as any;
    expect(res.status).toBe("error");
    expect(res.message).toContain("Unknown tool");
  });

  it("returns validation issues (not a throw) for bad args", async () => {
    const res = (await executeTool("search_places", { area: "Tiberias", type: "casino" })) as any;
    expect(res.status).toBe("error");
    expect(res.issues.join()).toContain("type");
    expect(trailService.searchCatalog).not.toHaveBeenCalled();
  });

  it("converts an executor throw into a structured error result", async () => {
    vi.mocked(trailService.searchOSM).mockRejectedValue(new Error("overpass down"));
    const res = (await executeTool("search_trails", { query: "Arbel" })) as any;
    expect(res).toEqual({ status: "error", message: "overpass down" });
  });

  it("serves skill references without touching any service", async () => {
    const res = (await executeTool("read_reference", { path: "trail-search/features" })) as any;
    expect(res.content).toContain("loop");
    const bad = (await executeTool("read_reference", { path: "nope/nope" })) as any;
    expect(bad.status).toBe("error");
    expect(bad.message).toContain("Available:");
  });

  it("echoes present_itinerary back as a preview payload", async () => {
    const res = (await executeTool("present_itinerary", {
      title: "Trip",
      start_date: "2026-07-11",
      days: [{ day_number: 1, date: "Sat" }],
    })) as any;
    expect(res.itinerary.title).toBe("Trip");
    expect(res.itinerary.days).toHaveLength(1);
  });

  it("rejects present_itinerary without a machine-readable start_date", async () => {
    const res = (await executeTool("present_itinerary", {
      title: "Trip",
      days: [{ day_number: 1, date: "Sat" }],
    })) as any;
    expect(res.status).toBe("error");
    expect(JSON.stringify(res.issues)).toContain("start_date");
  });
});
