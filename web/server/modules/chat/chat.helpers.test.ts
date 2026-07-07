import { describe, expect, it } from "vitest";
import {
  STEP_LABELS,
  backfillPlace,
  backfillTrail,
  isConcreteItinerary,
  mergeEditedItinerary,
} from "./chat.helpers";
import type { Itinerary } from "../../shared/types";

const day = (n: number, trailName?: string) => ({
  day_number: n,
  date: `Day ${n}`,
  trail: trailName ? { name: trailName } : undefined,
});

describe("isConcreteItinerary", () => {
  it("is true only when at least one day has a named trail", () => {
    expect(isConcreteItinerary({ title: "t", days: [day(1, "Nahal Amud")] } as Itinerary)).toBe(true);
    expect(isConcreteItinerary({ title: "t", days: [day(1)] } as Itinerary)).toBe(false);
    expect(isConcreteItinerary({ title: "t", days: [] } as unknown as Itinerary)).toBe(false);
    expect(isConcreteItinerary(null)).toBe(false);
  });
});

describe("backfillTrail", () => {
  const oldTrail = {
    name: "Nahal Amud",
    tiuli_url: "https://tiuli.com/x",
    waze: "https://waze.com/y",
    distance_km: "8",
  };

  it("restores fields the model dropped when the name is unchanged", () => {
    const merged = backfillTrail(oldTrail, { name: "nahal amud " }); // case/space-insensitive match
    expect(merged?.tiuli_url).toBe("https://tiuli.com/x");
    expect(merged?.waze).toBe("https://waze.com/y");
    expect(merged?.distance_km).toBe("8");
  });

  it("does NOT backfill when the trail actually changed", () => {
    const merged = backfillTrail(oldTrail, { name: "Mount Arbel" });
    expect(merged?.tiuli_url).toBeUndefined();
  });

  it("passes through null/undefined new values untouched", () => {
    expect(backfillTrail(oldTrail, null)).toBeNull();
    expect(backfillTrail(undefined, { name: "X" })).toEqual({ name: "X" });
  });

  it("never overwrites a field the model DID provide", () => {
    const merged = backfillTrail(oldTrail, { name: "Nahal Amud", distance_km: "9" });
    expect(merged?.distance_km).toBe("9");
  });
});

describe("backfillPlace", () => {
  it("restores maps/address for an unchanged place, not a changed one", () => {
    const oldP = { name: "Falafel Bar", maps: "m1", address: "a1" };
    expect(backfillPlace(oldP, { name: "Falafel Bar" })).toEqual({ name: "Falafel Bar", maps: "m1", address: "a1" });
    expect(backfillPlace(oldP, { name: "Other Place" })?.maps).toBeUndefined();
  });
});

describe("mergeEditedItinerary", () => {
  const saved: Itinerary = {
    title: "Trip",
    days: [
      { ...day(1, "Nahal Amud"), trail: { name: "Nahal Amud", tiuli_url: "u1" } },
      { ...day(2, "Arbel"), trail: { name: "Arbel", tiuli_url: "u2" } },
    ],
  } as Itinerary;

  it("keeps links on unchanged days, honors genuine changes", () => {
    const edited: Itinerary = {
      title: "Trip",
      days: [
        { day_number: 1, date: "Day 1", trail: { name: "Nahal Amud" } }, // unchanged → backfill
        { day_number: 2, date: "Day 2", trail: { name: "Mount Meron" } }, // changed → no backfill
      ],
    } as Itinerary;
    const merged = mergeEditedItinerary(saved, edited);
    expect(merged.days[0].trail?.tiuli_url).toBe("u1");
    expect(merged.days[1].trail?.tiuli_url).toBeUndefined();
    expect(merged.days[1].trail?.name).toBe("Mount Meron");
  });

  it("returns the new itinerary as-is when either side has no days", () => {
    const empty = { title: "t", days: [] } as unknown as Itinerary;
    expect(mergeEditedItinerary(empty, saved)).toBe(saved);
  });

  it("leaves days with no old counterpart untouched (trip grew)", () => {
    const edited = {
      title: "Trip",
      days: [...saved.days, { day_number: 3, date: "Day 3", trail: { name: "New Day" } }],
    } as Itinerary;
    const merged = mergeEditedItinerary(saved, edited);
    expect(merged.days[2].trail?.name).toBe("New Day");
  });
});

describe("STEP_LABELS", () => {
  it("maps both trail-search tools onto one checklist key", () => {
    expect(STEP_LABELS.search_tiuli.key).toBe(STEP_LABELS.search_trails.key);
  });
});
