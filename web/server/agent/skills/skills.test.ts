import { describe, expect, it } from "vitest";
import { buildSkillsBlock, getReference, listReferences, SKILLS } from "./index";

describe("skill registry", () => {
  it("injects every skill into the <available_skills> block", () => {
    const block = buildSkillsBlock();
    expect(block.startsWith("<available_skills>")).toBe(true);
    for (const s of SKILLS) {
      expect(block).toContain(`<skill name="${s.name}">`);
    }
    // Operative rules must survive the modularization.
    expect(block).toContain("PRIMARY trail source");
    expect(block).toContain("REGION FIRST");
    expect(block).toContain("WRITE NOTHING IN CHAT");
    expect(block).toContain("MANDATORY");
  });

  it("lists and resolves references", () => {
    const refs = listReferences();
    expect(refs).toEqual(
      expect.arrayContaining([
        "trail-search/features",
        "trail-search/regions",
        "trip-planning/itinerary-fields",
      ]),
    );
    for (const path of refs) {
      expect(getReference(path)).toBeTruthy();
    }
  });

  it("region reference is generated from the live gazetteer", () => {
    const regions = getReference("trail-search/regions")!;
    expect(regions).toContain("golan → גולן");
    expect(regions).toContain("dead sea → ים המלח");
  });

  it("returns null for unknown references", () => {
    expect(getReference("no-such/skill")).toBeNull();
    expect(getReference("trail-search/nope")).toBeNull();
    expect(getReference("")).toBeNull();
  });
});
