import { describe, expect, it } from "vitest";
import {
  STEP_LABELS,
  backfillPlace,
  backfillTrail,
  collectTrailCandidates,
  ensureStartDate,
  filterSavedTrails,
  findUncatalogedTrails,
  isConcreteItinerary,
  mergeEditedItinerary,
  newTrailCandidates,
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

describe("filterSavedTrails", () => {
  const refs = {
    names: ["Nahal Amud"],
    urls: ["https://tiuli.com/track/123"],
  };
  const byUrl = { name: "שביל אחר", tiuli_url: "https://tiuli.com/track/123" };
  const byName = { name: "  nahal amud " }; // OSM result: no tiuli_url
  const fresh = { name: "Nahal Yehudia", tiuli_url: "https://tiuli.com/track/999" };

  it("removes trails matching by tiuli_url or (case/space-insensitive) name", () => {
    const { filtered, removed } = filterSavedTrails({ trails: [byUrl, byName, fresh] }, refs);
    expect(removed).toBe(2);
    expect((filtered as any).trails).toEqual([fresh]);
    // The model must see WHAT was removed (to offer alternatives), not just a count.
    expect((filtered as any).excluded_saved.count).toBe(2);
    expect((filtered as any).excluded_saved.trails).toEqual([byUrl.name, "  nahal amud "]);
    expect((filtered as any).excluded_saved.note).toMatch(/search again/i);
  });

  it("returns the result untouched when nothing matches", () => {
    const result = { trails: [fresh], matched_by: "semantic" };
    const out = filterSavedTrails(result, refs);
    expect(out.removed).toBe(0);
    expect(out.filtered).toBe(result); // same reference — no needless copy
  });

  it("passes non-search-shaped results through (errors, weather, …)", () => {
    const err = { status: "error", message: "boom" };
    expect(filterSavedTrails(err, refs).filtered).toBe(err);
    expect(filterSavedTrails(null, refs).removed).toBe(0);
  });
});

describe("catalog-only itinerary gate", () => {
  const candidates = newTrailCandidates();
  collectTrailCandidates(
    [
      { name: "נחל עמוד", tiuli_url: "https://tiuli.com/track/123" },
      { name: "Mount Arbel" }, // candidate without url (edited-trip seed)
      null,
    ],
    candidates,
  );

  const itinerary = (...trails: Array<{ name?: string; tiuli_url?: string } | null>) =>
    ({
      title: "t",
      days: trails.map((trail, i) => ({ day_number: i + 1, trail })),
    }) as Itinerary;

  it("accepts trails matching by url even when the model translated the name", () => {
    const it_ = itinerary({ name: "Nahal Amud (translated)", tiuli_url: "https://tiuli.com/track/123" });
    expect(findUncatalogedTrails(it_, candidates)).toEqual([]);
  });

  it("accepts trails matching by normalized name without a url", () => {
    const it_ = itinerary({ name: "  mount arbel " });
    expect(findUncatalogedTrails(it_, candidates)).toEqual([]);
  });

  it("rejects invented trails and ignores trail-free rest days", () => {
    const it_ = itinerary({ name: "Metula Scenic Trail" }, null, { name: "נחל עמוד" });
    expect(findUncatalogedTrails(it_, candidates)).toEqual(["Metula Scenic Trail"]);
  });

  it("collects nothing from non-array input", () => {
    const empty = newTrailCandidates();
    collectTrailCandidates(undefined, empty);
    collectTrailCandidates({ not: "an array" }, empty);
    expect(empty.names.size).toBe(0);
    expect(empty.urls.size).toBe(0);
  });
});

describe("ensureStartDate", () => {
  const it_ = (start_date?: string) =>
    ({ title: "t", start_date, days: [] }) as Itinerary;

  it("keeps a valid YYYY-MM-DD start_date", () => {
    expect(ensureStartDate(it_("2026-08-01"), "2026-07-08").start_date).toBe("2026-08-01");
  });

  it("stamps the fallback on missing or malformed dates", () => {
    expect(ensureStartDate(it_(), "2026-07-08").start_date).toBe("2026-07-08");
    expect(ensureStartDate(it_("July 8"), "2026-07-08").start_date).toBe("2026-07-08");
    expect(ensureStartDate(it_("2026-7-8"), "2026-07-08").start_date).toBe("2026-07-08");
  });
});
