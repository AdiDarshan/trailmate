// Pure helpers for the chat agent loop — no I/O, fully unit-testable.
// The merge/backfill logic exists because LLMs routinely drop long "boring"
// fields (tiuli_url, waze, maps) when re-presenting an unchanged item; if the
// item's identifying name is unchanged we restore what the new version lost.

import type { Day, Itinerary, Place, SavedTrailRefs, Trail } from "../../shared/types";

// A plan is "concrete" — and worth switching the UI to the notebook — only when
// it has at least one day with an actual trail. Conversational answers,
// clarifying questions, and empty skeletons stay in the chat view.
export function isConcreteItinerary(it: Itinerary | null): boolean {
  return !!it && Array.isArray(it.days) && it.days.some((d) => !!d?.trail?.name);
}

const sameName = (a?: string, b?: string) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const TRAIL_BACKFILL_KEYS: (keyof Trail)[] = [
  "distance_km", "duration", "difficulty", "start_maps", "waze", "tiuli_url", "description",
];

/** Fill fields the model dropped when re-presenting an UNCHANGED trail. */
export function backfillTrail(oldT?: Trail | null, newT?: Trail | null): Trail | null | undefined {
  if (!newT || !oldT || !sameName(oldT.name, newT.name)) return newT;
  const merged: Trail = { ...newT };
  for (const k of TRAIL_BACKFILL_KEYS) {
    if (merged[k] == null || merged[k] === "") (merged[k] as any) = oldT[k];
  }
  return merged;
}

/** Fill address/maps the model dropped when re-presenting an UNCHANGED place. */
export function backfillPlace(oldP?: Place | null, newP?: Place | null): Place | null | undefined {
  if (!newP || !oldP || !sameName(oldP.name, newP.name)) return newP;
  return { ...newP, maps: newP.maps || oldP.maps, address: newP.address || oldP.address };
}

/**
 * On edit, merge the model's regenerated itinerary onto the saved one so
 * unchanged trails/places keep their links. Matches days by day_number; only
 * fills missing fields, so a genuine change (new trail, new restaurant) is
 * never overwritten.
 */
export function mergeEditedItinerary(oldIt: Itinerary, newIt: Itinerary): Itinerary {
  if (!oldIt.days?.length || !newIt.days?.length) return newIt;
  const oldByNum = new Map<number, Day>(oldIt.days.map((d) => [d.day_number, d]));
  const days = newIt.days.map((nd) => {
    const od = oldByNum.get(nd.day_number);
    if (!od) return nd;
    return {
      ...nd,
      trail: backfillTrail(od.trail, nd.trail),
      lunch: backfillPlace(od.lunch, nd.lunch),
      dinner: backfillPlace(od.dinner, nd.dinner),
      hotel: backfillPlace(od.hotel, nd.hotel),
    };
  });
  return { ...newIt, days };
}

/**
 * Drop already-saved trails from a trail-search tool result ({trails: [...]}).
 * Matches by tiuli_url where present, else by case/whitespace-insensitive name
 * (OSM results have no tiuli_url). When anything was removed, the returned
 * result carries `excluded_saved` naming the removed trails and telling the
 * model to search again if too few options remain — filtered results must read
 * as "already done", never as "nothing exists". Non-search-shaped results pass
 * through untouched.
 */
export function filterSavedTrails(
  result: unknown,
  refs: SavedTrailRefs,
): { filtered: unknown; removed: number } {
  const r = result as { trails?: Array<{ name?: string; tiuli_url?: string }> } | null;
  if (!r || !Array.isArray(r.trails)) return { filtered: result, removed: 0 };
  const urls = new Set(refs.urls);
  const names = new Set(refs.names.map((n) => n.trim().toLowerCase()));
  const isSaved = (t: { name?: string; tiuli_url?: string }) =>
    (!!t?.tiuli_url && urls.has(t.tiuli_url)) ||
    (!!t?.name && names.has(t.name.trim().toLowerCase()));
  const kept = r.trails.filter((t) => !isSaved(t));
  const removed = r.trails.length - kept.length;
  if (removed === 0) return { filtered: result, removed: 0 };
  const removedNames = r.trails.filter(isSaved).map((t) => t?.name ?? "(unnamed)");
  return {
    filtered: {
      ...r,
      trails: kept,
      excluded_saved: {
        count: removed,
        trails: removedNames,
        note:
          "These matching trails were removed because the user already has them in saved trips. " +
          "Do not recommend them. If too few options remain, search again with different criteria " +
          "(other region, distance, or query) to offer alternatives.",
      },
    },
    removed,
  };
}

const START_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Guarantee a machine-readable start_date on every presented itinerary —
 * reminders (hotel, day-before, weather) silently skip trips without one. The
 * schema requires it and the prompt tells the model to ask/default, but a
 * model that slips through gets stamped with the fallback (tomorrow).
 */
export function ensureStartDate(it: Itinerary, fallbackIso: string): Itinerary {
  if (typeof it.start_date === "string" && START_DATE_RE.test(it.start_date)) return it;
  return { ...it, start_date: fallbackIso };
}

// ── Catalog-only itinerary gate ──────────────────────────────────────────────
// Only trails the tiuli catalog actually returned (this turn, or already on the
// trip being edited / in saved trips) may be presented. This is the hard stop
// for hallucinated trails the model "remembers" from training data.

export interface TrailCandidates {
  names: Set<string>; // normalized (trim/lowercase)
  urls: Set<string>;
}

export function newTrailCandidates(): TrailCandidates {
  return { names: new Set(), urls: new Set() };
}

/** Record an array of trails (search result or itinerary days) as presentable. */
export function collectTrailCandidates(trails: unknown, into: TrailCandidates): void {
  if (!Array.isArray(trails)) return;
  for (const t of trails as Array<{ name?: string; tiuli_url?: string } | null | undefined>) {
    if (t?.name?.trim()) into.names.add(t.name.trim().toLowerCase());
    if (t?.tiuli_url) into.urls.add(t.tiuli_url);
  }
}

/**
 * Trails in a presented itinerary that never came from the catalog. A trail is
 * legitimate if EITHER its tiuli_url or its normalized name matches a candidate
 * (url is the stable key — it survives the model translating a Hebrew name).
 * Trail-free days (rest days) are ignored.
 */
export function findUncatalogedTrails(itinerary: Itinerary, candidates: TrailCandidates): string[] {
  const unknown: string[] = [];
  for (const day of itinerary?.days ?? []) {
    const t = day?.trail;
    if (!t || (!t.name && !t.tiuli_url)) continue;
    const nameOk = !!t.name && candidates.names.has(t.name.trim().toLowerCase());
    const urlOk = !!t.tiuli_url && candidates.urls.has(t.tiuli_url);
    if (!nameOk && !urlOk) unknown.push(t.name?.trim() || t.tiuli_url!);
  }
  return unknown;
}

// Friendly labels for the inline "working" checklist. Keyed so repeated calls
// of the same kind (e.g. two trail searches for a 2-day trip) show as one row.
export const STEP_LABELS: Record<string, { key: string; label: string }> = {
  search_tiuli: { key: "trail", label: "Finding a trail" },
  search_trails: { key: "trail", label: "Finding a trail" },
  search_places: { key: "places", label: "Picking food & a place to sleep" },
  get_weather: { key: "weather", label: "Checking the weather" },
  present_itinerary: { key: "itinerary", label: "Putting your itinerary together" },
};
