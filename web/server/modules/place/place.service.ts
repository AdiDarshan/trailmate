// Place business logic — restaurants / hotels / attractions via Nominatim +
// Overpass. No DB; talks to external OSM APIs only.

import { createLogger } from "../../shared/logger";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const TIMEOUT_S = 25;
const DEFAULT_MAX = 5;

const TYPE_TAGS: Record<string, string[]> = {
  restaurant: ['["amenity"="restaurant"]', '["amenity"="cafe"]'],
  hotel: [
    '["tourism"="hotel"]',
    '["tourism"="hostel"]',
    '["tourism"="guest_house"]',
    '["tourism"="apartment"]',
  ],
  attraction: [
    '["tourism"="attraction"]',
    '["tourism"="museum"]',
    '["tourism"="viewpoint"]',
    '["tourism"="archaeological_site"]',
    '["historic"="ruins"]',
    '["historic"="archaeological_site"]',
    '["leisure"="nature_reserve"]',
  ],
};

// Specific accommodation kinds — the user's "Stay" preference maps here.
const STAY_TAGS: Record<string, string> = {
  hotel: '["tourism"="hotel"]',
  guesthouse: '["tourism"="guest_house"]',
  hostel: '["tourism"="hostel"]',
  apartment: '["tourism"="apartment"]',
};

export interface PlaceFilters {
  stayType?: string; // hotel | guesthouse | hostel | apartment
  diet?: string; //     kosher | vegetarian | vegan
  cuisine?: string; //  free keyword, e.g. "italian"
  minStars?: number;
}

/**
 * Overpass tag selectors for a typed search + optional filters. Pure; exported
 * for tests. diet/cuisine become real query predicates (OSM: diet:kosher=yes,
 * cuisine=*); stay_type narrows the accommodation tag. min_stars is NOT here —
 * it's post-filtered in code because OSM stores stars as a string.
 */
export function buildSelectors(type: string, f: PlaceFilters = {}): string[] {
  let base = TYPE_TAGS[type] ?? [];
  if (type === "hotel" && f.stayType && STAY_TAGS[f.stayType]) base = [STAY_TAGS[f.stayType]];
  const extra: string[] = [];
  if (type === "restaurant" && f.diet) extra.push(`["diet:${f.diet}"~"yes|only"]`);
  if (type === "restaurant" && f.cuisine) {
    // Whitelist chars so a free-form keyword can't break out of the regex.
    const safe = f.cuisine.toLowerCase().replace(/[^a-z0-9_ -]/g, "").trim().replace(/\s+/g, "_");
    if (safe) extra.push(`["cuisine"~"${safe}",i]`);
  }
  return base.map((b) => b + extra.join(""));
}

const UA = { "User-Agent": "TrailMate/1.0 (travel planning agent)" };

const log = createLogger("place.service");

async function getJson(url: string): Promise<any> {
  return log.timed("http_get", { host: new URL(url).host }, async () => {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

async function postJson(url: string, body: string): Promise<any> {
  return log.timed("http_post", { host: new URL(url).host }, async () => {
    const res = await fetch(url, { method: "POST", headers: UA, body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

type BBox = [number, number, number, number]; // south, west, north, east

// Region names ("Negev", "Galilee") often geocode to a point label in the
// middle of nowhere, so the derived box misses every town. When a search comes
// back completely empty we retry once in a box at least this half-size (~30km).
const WIDEN_MIN_HALF_DEG = 0.3;

function widen(bbox: BBox): BBox {
  const [s, w, n, e] = bbox;
  const latHalf = Math.max(((n - s) / 2) * 3, WIDEN_MIN_HALF_DEG);
  const lonHalf = Math.max(((e - w) / 2) * 3, WIDEN_MIN_HALF_DEG);
  const latC = (s + n) / 2;
  const lonC = (w + e) / 2;
  return [latC - latHalf, lonC - lonHalf, latC + latHalf, lonC + lonHalf];
}

async function geocode(area: string): Promise<BBox> {
  const params = new URLSearchParams({
    q: `${area}, Israel`,
    format: "json",
    limit: "1",
    countrycodes: "il",
  });
  const results = await getJson(`${NOMINATIM_URL}?${params}`);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(`Could not find area: ${area}`);
  }
  const r = results[0];
  const lat = parseFloat(r.lat);
  const lon = parseFloat(r.lon);

  if (r.osm_type === "way" || r.osm_type === "relation") {
    const bb = r.boundingbox ?? [];
    if (bb.length === 4) {
      const s = parseFloat(bb[0]);
      const n = parseFloat(bb[1]);
      const w = parseFloat(bb[2]);
      const e = parseFloat(bb[3]);
      const maxDelta = 0.45;
      if (n - s <= maxDelta * 2 && e - w <= maxDelta * 2) return [s, w, n, e];
    }
  }
  const placeRank = r.place_rank ?? 20;
  const delta = placeRank <= 12 ? 0.23 : 0.1;
  return [lat - delta, lon - delta, lat + delta, lon + delta];
}

async function overpassSearch(bbox: BBox, tags: string[], maxResults: number) {
  const [s, w, n, e] = bbox;
  const bboxStr = `${s},${w},${n},${e}`;
  const parts: string[] = [];
  for (const tag of tags) {
    parts.push(`node${tag}(${bboxStr});`);
    parts.push(`way${tag}(${bboxStr});`);
  }
  const query = `[out:json][timeout:${TIMEOUT_S}];(${parts.join(" ")});out center tags ${maxResults * 3};`;
  const resp = await postJson(OVERPASS_URL, query);
  return resp.elements ?? [];
}

/** Shape one Overpass element into a place result. Pure; exported for tests. */
export function formatElement(el: any, placeType: string): Record<string, any> | null {
  const tags = el.tags ?? {};
  const name = tags.name || tags["name:en"] || tags["name:he"];
  if (!name) return null;

  const result: Record<string, any> = { name, type: placeType };

  const addrParts: string[] = [];
  for (const key of ["addr:street", "addr:housenumber", "addr:city"]) {
    if (tags[key]) addrParts.push(tags[key]);
  }
  if (addrParts.length) result.address = addrParts.join(", ");
  else if (tags["addr:city"]) result.address = tags["addr:city"];

  if (el.center) result.location = { lat: el.center.lat, lng: el.center.lon };
  else if (el.type === "node") result.location = { lat: el.lat, lng: el.lon };
  if (result.location) {
    result.maps = `https://www.google.com/maps?q=${result.location.lat},${result.location.lng}`;
  }

  const phone = tags.phone || tags["contact:phone"];
  if (phone) result.phone = phone;
  const website = tags.website || tags["contact:website"];
  if (website) result.website = website;
  if (tags.opening_hours) result.opening_hours = tags.opening_hours;
  if (placeType === "restaurant" && tags.cuisine)
    result.cuisine = String(tags.cuisine).replace(/;/g, ", ");
  // Surface the judgeable attributes: diet tags and hotel stars.
  const diets = ["kosher", "vegetarian", "vegan"].filter((d) => {
    const v = tags[`diet:${d}`];
    return v === "yes" || v === "only";
  });
  if (diets.length) result.diet = diets;
  if (tags.stars) {
    const s = parseFloat(tags.stars);
    if (!Number.isNaN(s)) result.stars = s;
  }
  if (placeType === "hotel" && tags.tourism) result.stay_type = tags.tourism.replace("guest_house", "guesthouse");
  const desc = tags.description || tags["description:en"] || tags.wikipedia;
  if (desc) result.description = String(desc).slice(0, 200);

  if (el.id) result.osm_url = `https://www.openstreetmap.org/${el.type ?? "node"}/${el.id}`;
  return result;
}

class PlaceService {
  async search(area: string, type: string, max = DEFAULT_MAX, filters: PlaceFilters = {}) {
    if (!area) throw new Error("area is required");
    if (!TYPE_TAGS[type]) throw new Error(`Unknown type: ${type}`);
    const maxResults = Math.max(1, Math.min(15, max));

    const bbox = await geocode(area);
    const selectors = buildSelectors(type, filters);
    const hasFilters = selectors.join("|") !== buildSelectors(type).join("|");

    // OSM tag coverage is incomplete — an over-strict filter must degrade to
    // the unfiltered search WITH a note, never to a silent empty result.
    const attempt = async (box: BBox) => {
      const els = await overpassSearch(box, selectors, maxResults);
      if (els.length > 0 || !hasFilters) return { els, relaxed: false };
      log.info("place_filters_relaxed", { area, type, ...filters });
      return { els: await overpassSearch(box, buildSelectors(type), maxResults), relaxed: true };
    };

    let { els: elements, relaxed } = await attempt(bbox);
    let widened = false;
    if (elements.length === 0) {
      widened = true;
      log.info("place_area_widened", { area, type });
      ({ els: elements, relaxed } = await attempt(widen(bbox)));
    }

    const results: Record<string, any>[] = [];
    const seen = new Set<string>();
    for (const el of elements) {
      const place = formatElement(el, type);
      if (!place || seen.has(place.name)) continue;
      // Stars are post-filtered (string tag): drop places KNOWN to be below
      // the bar; unrated places stay in, visibly missing a `stars` field.
      if (!relaxed && filters.minStars != null && place.stars != null && place.stars < filters.minStars) continue;
      seen.add(place.name);
      results.push(place);
      if (results.length >= maxResults) break;
    }
    // Notes only describe results that exist — an empty list must say so
    // explicitly, or the model fills the gap with invented places.
    if (results.length === 0) {
      return {
        places: [],
        note:
          "No places of this type were found in or near this area. Do NOT invent or " +
          "suggest places from memory — tell the user nothing was found and ask for a " +
          "specific nearby town or city to search instead.",
      };
    }
    return {
      places: results,
      ...(relaxed && {
        filter_note:
          "No places in this area matched the requested filters (OSM tagging is incomplete) — " +
          "these are UNFILTERED results. Tell the user, and judge suitability from each " +
          "place's name, cuisine, and description instead of assuming.",
      }),
      ...(widened && {
        area_note:
          "Nothing matched inside the named area itself — these results come from a wider " +
          "surrounding area (up to ~30 km away). Mention this to the user.",
      }),
    };
  }
}

export const placeService = new PlaceService();
