import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatElement, placeService } from "./place.service";

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
