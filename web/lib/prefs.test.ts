import { describe, expect, it } from "vitest";
import { EMPTY_PICKS, countSetPrefs, parsePrefs, serializePrefs } from "./prefs";

describe("preferences serialization", () => {
  it("round-trips a full set of picks plus free text", () => {
    const picks = {
      difficulty: "easy",
      length: "5-10 km",
      diet: "kosher",
      stay: "hotel",
      extra: "dog joins every hike. no crowded spots",
    };
    const text = serializePrefs(picks);
    expect(text).toBe(
      "Trail difficulty: easy. Trail length: 5-10 km. Diet: kosher. Stay: hotel. " +
        "Also: dog joins every hike. no crowded spots",
    );
    expect(parsePrefs(text)).toEqual(picks);
  });

  it("round-trips partial picks and empty state", () => {
    const picks = { ...EMPTY_PICKS, diet: "vegan" };
    expect(parsePrefs(serializePrefs(picks))).toEqual(picks);
    expect(serializePrefs(EMPTY_PICKS)).toBe("");
    expect(parsePrefs("")).toEqual(EMPTY_PICKS);
  });

  it("parses legacy free text (old textarea format) into extra", () => {
    const legacy = "vegetarian, easy trails under 8km, budget hotels";
    expect(parsePrefs(legacy)).toEqual({ ...EMPTY_PICKS, extra: legacy });
  });

  it("drops unknown option values instead of rendering bogus chips", () => {
    const picks = parsePrefs("Trail difficulty: extreme. Diet: kosher");
    expect(picks.difficulty).toBeNull();
    expect(picks.diet).toBe("kosher");
  });

  it("counts set picks for the sidebar badge", () => {
    expect(countSetPrefs(EMPTY_PICKS)).toBe(0);
    expect(countSetPrefs({ ...EMPTY_PICKS, diet: "vegan", extra: "x" })).toBe(2);
  });
});
