// Pure trail logic — geometry, difficulty, duration, OSMC parsing, region
// re-ranking. No network, no DB.

import { describe, expect, it } from "vitest";
import { classifyDifficulty, estimateDuration, parseColor, rerankByRegion } from "./trail.service";
import type { TrailRow } from "./trail.dbservice";

describe("classifyDifficulty", () => {
  it("scores distance + climb into easy/moderate/hard", () => {
    expect(classifyDifficulty(3, 100)).toBe("easy"); // 3 + 1 = 4 < 5
    expect(classifyDifficulty(8, 300)).toBe("moderate"); // 8 + 3 = 11
    expect(classifyDifficulty(12, 400)).toBe("hard"); // 12 + 4 = 16
  });

  it("treats elevation as the equalizer for short-but-steep trails", () => {
    expect(classifyDifficulty(2, 1400)).toBe("hard"); // 2 + 14 = 16
  });
});

describe("estimateDuration", () => {
  it("rounds to half-hours with h/min formatting", () => {
    expect(estimateDuration(4, 0)).toBe("1h"); // 1.0h
    expect(estimateDuration(6, 0)).toBe("1h 30min"); // 1.5h
    expect(estimateDuration(1, 0)).toBe("30 min"); // 0.25h → 0.5
  });

  it("adds climbing time (600m gain ≈ +1h)", () => {
    expect(estimateDuration(4, 600)).toBe("2h");
  });
});

describe("parseColor", () => {
  it("extracts a known color from an osmc:symbol", () => {
    expect(parseColor("red:white:red_stripe")).toBe("red");
    expect(parseColor("black:blue_dot")).toBe("black");
  });

  it("returns empty for unknown symbols", () => {
    expect(parseColor("purple:pink")).toBe("");
    expect(parseColor("")).toBe("");
  });
});

describe("rerankByRegion", () => {
  const row = (name: string, region: string, sub: string, sim: number): TrailRow =>
    ({ name_he: name, region_he: region, subregion_he: sub, area_he: "", similarity: sim }) as TrailRow;

  it("more region-word matches beat higher semantic similarity", () => {
    const rows = [
      row("generic-negev", "נגב", "", 0.9),
      row("western-negev", "נגב", "נגב מערבי", 0.5),
    ];
    const ranked = rerankByRegion(rows, "נגב מערבי");
    expect(ranked[0].name_he).toBe("western-negev"); // matches both words
  });

  it("falls back to similarity as the tie-break", () => {
    const rows = [row("a", "גליל", "", 0.4), row("b", "גליל", "", 0.8)];
    expect(rerankByRegion(rows, "גליל")[0].name_he).toBe("b");
  });

  it("is a no-op for a region with no usable words", () => {
    const rows = [row("a", "x", "", 0.1), row("b", "y", "", 0.9)];
    expect(rerankByRegion(rows, "  ").map((r) => r.name_he)).toEqual(["a", "b"]);
  });
});
