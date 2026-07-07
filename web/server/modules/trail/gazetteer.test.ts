import { describe, expect, it } from "vitest";
import { normalizeRegion, PLACE_GAZETTEER } from "./gazetteer";

describe("normalizeRegion", () => {
  it("maps English aliases to Hebrew search tokens, case-insensitively", () => {
    expect(normalizeRegion("Golan")).toBe("גולן");
    expect(normalizeRegion("the Golan Heights")).toBe("גולן");
    expect(normalizeRegion("DEAD SEA")).toBe("ים המלח");
  });

  it("passes Hebrew and unknown places through trimmed", () => {
    expect(normalizeRegion(" גליל עליון ")).toBe("גליל עליון");
    expect(normalizeRegion("Mitzpe Ramon town center")).toBe("Mitzpe Ramon town center");
  });

  it("returns undefined for missing/blank input", () => {
    expect(normalizeRegion(undefined)).toBeUndefined();
    expect(normalizeRegion("   ")).toBeUndefined();
  });

  it("every gazetteer value is a non-empty Hebrew token", () => {
    for (const [alias, token] of Object.entries(PLACE_GAZETTEER)) {
      expect(token.length, `empty token for ${alias}`).toBeGreaterThan(0);
      expect(/[֐-׿]/.test(token), `non-Hebrew token for ${alias}`).toBe(true);
    }
  });
});
