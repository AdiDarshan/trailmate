// The tool contract: the JSON Schema shown to the model and the Zod
// validation applied to its calls come from the same specs, so these tests
// guard both sides of the boundary.

import { describe, expect, it } from "vitest";
import { TOOL_SCHEMAS, TOOL_SPECS } from "./tools.schemas";

describe("TOOL_SCHEMAS (advertised contract)", () => {
  it("emits a well-formed OpenAI function schema per tool", () => {
    expect(TOOL_SCHEMAS).toHaveLength(Object.keys(TOOL_SPECS).length);
    for (const t of TOOL_SCHEMAS) {
      expect(t.type).toBe("function");
      expect(t.function.name).toBeTruthy();
      expect(t.function.description).toBeTruthy();
      const params = t.function.parameters as Record<string, unknown>;
      expect(params.type).toBe("object");
      expect(params).not.toHaveProperty("$schema");
    }
  });

  it("marks the right fields required", () => {
    const byName = Object.fromEntries(TOOL_SCHEMAS.map((t) => [t.function.name, t.function.parameters as any]));
    expect(byName.search_tiuli.required).toEqual(["query"]);
    expect(byName.search_places.required).toEqual(expect.arrayContaining(["area", "type"]));
    expect(byName.get_weather.required).toEqual(["location"]);
    expect(byName.present_itinerary.required).toEqual(expect.arrayContaining(["title", "days"]));
  });

  it("keeps parameter descriptions (the model's usage guidance)", () => {
    const tiuli = TOOL_SCHEMAS.find((t) => t.function.name === "search_tiuli")!;
    const props = (tiuli.function.parameters as any).properties;
    expect(props.region.description).toContain("MOST SPECIFIC");
    expect(props.features.items.enum).toContain("water");
  });
});

describe("TOOL_SPECS (runtime validation)", () => {
  it("coerces numeric strings the model sometimes sends", () => {
    const parsed = TOOL_SPECS.search_tiuli.args.parse({
      query: "family hike",
      max_km: "6",
      difficulty_max: "2",
      limit: "5",
    });
    expect(parsed.max_km).toBe(6);
    expect(parsed.difficulty_max).toBe(2);
    expect(parsed.limit).toBe(5);
  });

  it("rejects unknown feature tags and invalid place types", () => {
    expect(
      TOOL_SPECS.search_tiuli.args.safeParse({ query: "x", features: ["waterfall-park"] }).success,
    ).toBe(false);
    expect(
      TOOL_SPECS.search_places.args.safeParse({ area: "Tiberias", type: "spa" }).success,
    ).toBe(false);
  });

  it("accepts a realistic present_itinerary payload and coerces day_number", () => {
    const parsed = TOOL_SPECS.present_itinerary.args.parse({
      title: "2-Day Trip: Galilee",
      start_date: "2026-07-11",
      days: [
        {
          day_number: "1",
          date: "Saturday, July 11",
          trail: { name: "Nahal Amud", tiuli_url: "https://tiuli.com/x" },
          lunch: { name: "Falafel Bar", maps: "https://maps.google.com/?q=1,2" },
          made_up_field: "dropped",
        },
      ],
    });
    expect(parsed.days[0].day_number).toBe(1);
    expect(parsed.days[0].trail?.name).toBe("Nahal Amud");
    expect(parsed.days[0]).not.toHaveProperty("made_up_field");
  });

  it("rejects a day without its required identity fields", () => {
    const res = TOOL_SPECS.present_itinerary.args.safeParse({
      title: "Trip",
      days: [{ weather: "Sunny" }],
    });
    expect(res.success).toBe(false);
  });
});
