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
  const desc = tags.description || tags["description:en"] || tags.wikipedia;
  if (desc) result.description = String(desc).slice(0, 200);

  if (el.id) result.osm_url = `https://www.openstreetmap.org/${el.type ?? "node"}/${el.id}`;
  return result;
}

class PlaceService {
  async search(area: string, type: string, max = DEFAULT_MAX) {
    const tags = TYPE_TAGS[type];
    if (!area) throw new Error("area is required");
    if (!tags) throw new Error(`Unknown type: ${type}`);
    const maxResults = Math.max(1, Math.min(15, max));

    const bbox = await geocode(area);
    const elements = await overpassSearch(bbox, tags, maxResults);
    const results: Record<string, any>[] = [];
    const seen = new Set<string>();
    for (const el of elements) {
      const place = formatElement(el, type);
      if (place && !seen.has(place.name)) {
        seen.add(place.name);
        results.push(place);
      }
      if (results.length >= maxResults) break;
    }
    return { places: results };
  }
}

export const placeService = new PlaceService();
