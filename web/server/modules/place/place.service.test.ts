import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSelectors, formatElement, placeService } from "./place.service";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("formatElement (pure)", () => {
  it("builds name/address/maps from OSM tags", () => {
    const el = {
      type: "node", id: 42, lat: 32.7, lon: 35.5,
      tags: {
        name: "Falafel HaGolan",
        "addr:street": "Main St", "addr:housenumber": "3", "addr:city": "Katzrin",
        cuisine: "falafel;hummus", phone: "04-1234567",
      },
    };
    const out = formatElement(el, "restaurant")!;
    expect(out.name).toBe("Falafel HaGolan");
    expect(out.address).toBe("Main St, 3, Katzrin");
    expect(out.maps).toContain("32.7,35.5");
    expect(out.cuisine).toBe("falafel, hummus");
    expect(out.osm_url).toBe("https://www.openstreetmap.org/node/42");
  });

  it("returns null for unnamed elements (unusable results)", () => {
    expect(formatElement({ tags: { amenity: "restaurant" } }, "restaurant")).toBeNull();
  });

  it("uses way center coordinates when present", () => {
    const el = { type: "way", id: 7, center: { lat: 31.5, lon: 35.1 }, tags: { name: "Dead Sea Lookout" } };
    expect(formatElement(el, "attraction")!.location).toEqual({ lat: 31.5, lng: 35.1 });
  });
});

describe("placeService.search", () => {
  it("rejects unknown place types before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(placeService.search("Tiberias", "casino")).rejects.toThrow("Unknown type: casino");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("geocodes, queries Overpass, and dedupes by name", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("nominatim")) {
        return { ok: true, json: async () => [{ lat: "32.79", lon: "35.53", place_rank: 16 }] } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          elements: [
            { type: "node", id: 1, lat: 1, lon: 1, tags: { name: "Decks" } },
            { type: "node", id: 2, lat: 2, lon: 2, tags: { name: "Decks" } }, // duplicate name
            { type: "node", id: 3, lat: 3, lon: 3, tags: { name: "Galei Gil" } },
          ],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await placeService.search("Tiberias", "restaurant");
    expect(out.places.map((p: any) => p.name)).toEqual(["Decks", "Galei Gil"]);
  });

  it("propagates a descriptive error when the area can't be geocoded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] }) as Response));
    await expect(placeService.search("Nowhere", "hotel")).rejects.toThrow("Could not find area: Nowhere");
  });
});

describe("buildSelectors (pure)", () => {
  it("adds diet and cuisine predicates to restaurant selectors", () => {
    const sel = buildSelectors("restaurant", { diet: "kosher", cuisine: "Middle Eastern" });
    expect(sel).toEqual([
      '["amenity"="restaurant"]["diet:kosher"~"yes|only"]["cuisine"~"middle_eastern",i]',
      '["amenity"="cafe"]["diet:kosher"~"yes|only"]["cuisine"~"middle_eastern",i]',
    ]);
  });

  it("narrows hotel searches to the requested stay kind", () => {
    expect(buildSelectors("hotel", { stayType: "guesthouse" })).toEqual(['["tourism"="guest_house"]']);
    // Unfiltered hotel search keeps all accommodation kinds.
    expect(buildSelectors("hotel")).toHaveLength(4);
  });

  it("strips regex-hostile characters from free-form cuisine", () => {
    const sel = buildSelectors("restaurant", { cuisine: 'fish"](.*' });
    expect(sel[0]).toContain('["cuisine"~"fish",i]');
  });
});

describe("placeService.search with filters", () => {
  it("relaxes to an unfiltered search (with filter_note) when filters match nothing", async () => {
    let overpassCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("nominatim")) {
        return { ok: true, json: async () => [{ lat: "32.79", lon: "35.53", place_rank: 16 }] } as Response;
      }
      overpassCalls++;
      return {
        ok: true,
        json: async () => ({
          elements:
            overpassCalls === 1
              ? [] // strict (kosher) query: nothing tagged
              : [{ type: "node", id: 1, lat: 1, lon: 1, tags: { name: "Decks" } }],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await placeService.search("Tiberias", "restaurant", 5, { diet: "kosher" });
    expect(overpassCalls).toBe(2);
    expect(out.places.map((p: any) => p.name)).toEqual(["Decks"]);
    expect((out as any).filter_note).toMatch(/unfiltered/i);
  });

  it("retries a wider box (with area_note) when the geocoded area has nothing", async () => {
    const overpassBodies: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: { body?: unknown }) => {
      if (url.includes("nominatim")) {
        // A region label node — the derived box is a small patch of empty desert.
        return { ok: true, json: async () => [{ lat: "30.5", lon: "34.92", place_rank: 22 }] } as Response;
      }
      overpassBodies.push(String(init?.body));
      return {
        ok: true,
        json: async () => ({
          elements:
            overpassBodies.length === 1
              ? [] // original box: empty
              : [{ type: "node", id: 1, lat: 30.61, lon: 34.8, tags: { name: "Ramon Inn", tourism: "hotel" } }],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await placeService.search("Negev", "hotel");
    expect(overpassBodies).toHaveLength(2);
    // Second query spans the widened box (center ± 0.3), not the original ± 0.1.
    expect(overpassBodies[1]).toContain("34.62");
    expect(out.places.map((p: any) => p.name)).toEqual(["Ramon Inn"]);
    expect((out as any).area_note).toMatch(/wider/i);
  });

  it("returns an explicit empty note (never filter_note) when even the widened search is empty", async () => {
    let overpassCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("nominatim")) {
        return { ok: true, json: async () => [{ lat: "30.5", lon: "34.92", place_rank: 22 }] } as Response;
      }
      overpassCalls++;
      return { ok: true, json: async () => ({ elements: [] }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await placeService.search("Negev", "hotel", 5, { stayType: "hotel" });
    // filtered + relaxed in the original box, then filtered + relaxed in the wide box
    expect(overpassCalls).toBe(4);
    expect(out.places).toEqual([]);
    expect((out as any).note).toMatch(/nothing was found|do not invent/i);
    expect((out as any).filter_note).toBeUndefined();
  });

  it("drops hotels known to be below min_stars but keeps unrated ones", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("nominatim")) {
        return { ok: true, json: async () => [{ lat: "32.79", lon: "35.53", place_rank: 16 }] } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          elements: [
            { type: "node", id: 1, lat: 1, lon: 1, tags: { name: "Two Star Inn", tourism: "hotel", stars: "2" } },
            { type: "node", id: 2, lat: 2, lon: 2, tags: { name: "Grand Galilee", tourism: "hotel", stars: "5" } },
            { type: "node", id: 3, lat: 3, lon: 3, tags: { name: "Mystery Lodge", tourism: "hotel" } },
          ],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await placeService.search("Tiberias", "hotel", 5, { minStars: 4 });
    expect(out.places.map((p: any) => p.name)).toEqual(["Grand Galilee", "Mystery Lodge"]);
    expect(out.places[0].stars).toBe(5);
    expect(out.places[0].stay_type).toBe("hotel");
  });
});
