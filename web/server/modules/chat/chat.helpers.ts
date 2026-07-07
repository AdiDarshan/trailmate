// Pure helpers for the chat agent loop — no I/O, fully unit-testable.
// The merge/backfill logic exists because LLMs routinely drop long "boring"
// fields (tiuli_url, waze, maps) when re-presenting an unchanged item; if the
// item's identifying name is unchanged we restore what the new version lost.

import type { Day, Itinerary, Place, Trail } from "../../shared/types";

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

// Friendly labels for the inline "working" checklist. Keyed so repeated calls
// of the same kind (e.g. two trail searches for a 2-day trip) show as one row.
export const STEP_LABELS: Record<string, { key: string; label: string }> = {
  search_tiuli: { key: "trail", label: "Finding a trail" },
  search_trails: { key: "trail", label: "Finding a trail" },
  search_places: { key: "places", label: "Picking food & a place to sleep" },
  get_weather: { key: "weather", label: "Checking the weather" },
  present_itinerary: { key: "itinerary", label: "Putting your itinerary together" },
};
