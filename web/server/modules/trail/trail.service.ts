// Trail business logic. Two sources:
//   - searchCatalog: the curated tiuli catalog (via TrailDbService)
//   - searchOSM:     live Israel Hiking Map / Overpass 3-API enrichment
// Both return plain objects; errors throw and are wrapped by the tool layer.

import OpenAI from "openai";
import { trailDbService, type TrailFilters, type TrailRow } from "./trail.dbservice";
import { normalizeRegion } from "./gazetteer";

const EMBED_MODEL = "text-embedding-3-small";

/** Embed a query string for semantic trail matching. Returns null if unavailable. */
async function embedQuery(text: string): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY || !text.trim()) return null;
  try {
    const res = await new OpenAI().embeddings.create({ model: EMBED_MODEL, input: text });
    return res.data[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const IHM_BASE = "https://israelhiking.osm.org.il/api";
const DEFAULT_MAX_KM = 30;
const ROUTING_MIN_GAP = 500; // ms between routing calls
const UA = { "User-Agent": "TrailMate/1.0 (travel planning)" };

type Pt = [number, number]; // [lat, lng]

function mapsLink(lat: number | null, lng: number | null): string | undefined {
  if (lat == null || lng == null) return undefined;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postOverpass(body: string): Promise<any> {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: body }).toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function haversine(p1: Pt, p2: Pt): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(p1[0]);
  const lat2 = toRad(p2[0]);
  const a =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(toRad(p2[1] - p1[1]) / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function totalDistanceKm(coords: Pt[]): number {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) total += haversine(coords[i], coords[i + 1]);
  return Math.round((total / 1000) * 10) / 10;
}

function classifyDifficulty(distKm: number, gainM: number): string {
  const score = distKm + gainM / 100;
  if (score < 5) return "easy";
  if (score < 15) return "moderate";
  return "hard";
}

function estimateDuration(distKm: number, gainM: number): string {
  const hoursRaw = distKm / 4.0 + gainM / 600.0;
  const halfHours = Math.round(hoursRaw * 2);
  const hours = Math.floor(halfHours / 2);
  const mins = halfHours % 2 ? 30 : 0;
  if (hours === 0) return `${mins || 30} min`;
  return mins ? `${hours}h ${mins}min` : `${hours}h`;
}

function parseColor(osmc: string): string {
  const known = new Set(["red", "blue", "green", "black", "orange", "white", "yellow"]);
  for (const part of osmc.split(":")) {
    const word = part.split("_")[0];
    if (known.has(word)) return word;
  }
  return "";
}

async function ihmSearch(query: string, language: string, maxResults: number): Promise<any[]> {
  const url = `${IHM_BASE}/search/${encodeURIComponent(query)}?language=${language}`;
  const results = await getJson(url);
  return (Array.isArray(results) ? results : [])
    .filter(
      (r) => String(r.icon ?? "").includes("hike") && String(r.id ?? "").startsWith("relation_"),
    )
    .slice(0, maxResults);
}

async function overpassTags(osmType: string, osmId: string): Promise<Record<string, string>> {
  const data =
    osmType === "relation"
      ? `[out:json];relation(${osmId});out tags;`
      : `[out:json];way(${osmId});out tags;`;
  const resp = await postOverpass(data);
  return resp.elements?.[0]?.tags ?? {};
}

async function overpassGeometry(osmType: string, osmId: string): Promise<Pt[]> {
  const coords: Pt[] = [];
  const data =
    osmType === "relation"
      ? `[out:json];relation(${osmId});way(r);out geom;`
      : `[out:json];way(${osmId});out geom;`;
  const resp = await postOverpass(data);
  for (const el of resp.elements ?? []) {
    for (const node of el.geometry ?? []) coords.push([node.lat, node.lon]);
  }
  return coords;
}

async function routingDistanceElevation(start: Pt, end: Pt) {
  if (haversine(start, end) < 200) return null;
  const url = `${IHM_BASE}/routing?from=${start[0]},${start[1]}&to=${end[0]},${end[1]}&type=Hike`;
  let data: any;
  try {
    data = await getJson(url);
  } catch {
    return null;
  }
  const coords = data?.features?.[0]?.geometry?.coordinates ?? [];
  if (coords.length < 2) return null;
  let distM = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    distM += haversine([coords[i][1], coords[i][0]], [coords[i + 1][1], coords[i + 1][0]]);
  }
  const distKm = Math.round((distM / 1000) * 10) / 10;
  if (distKm === 0) return null;
  const elevs = coords.filter((c: number[]) => c.length > 2 && c[2] != null).map((c: number[]) => c[2]);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < elevs.length; i++) {
    const diff = elevs[i] - elevs[i - 1];
    if (diff > 0) gain += diff;
    else loss += Math.abs(diff);
  }
  return { distance_km: distKm, elevation_gain_m: Math.round(gain), elevation_loss_m: Math.round(loss) };
}

function carLogistics(tags: Record<string, string>, coords: Pt[]): string {
  const roundtrip = String(tags.roundtrip ?? "").toLowerCase();
  if (roundtrip === "yes") return "loop — 1 car";
  if (roundtrip === "no") return "linear — 2 cars or shuttle";
  if (coords.length >= 2 && haversine(coords[0], coords[coords.length - 1]) < 500) return "loop — 1 car";
  return coords.length ? "linear — 2 cars or shuttle" : "unknown";
}

async function enrichOsm(trail: any): Promise<Record<string, any>> {
  const info: Record<string, any> = {
    name: trail.title,
    display_name: trail.displayName,
    location: trail.location,
  };
  const rawId: string = trail.id ?? "";
  let osmType: string;
  let osmId: string;
  if (rawId.startsWith("relation_")) [osmType, osmId] = ["relation", rawId.replace("relation_", "")];
  else if (rawId.startsWith("way_")) [osmType, osmId] = ["way", rawId.replace("way_", "")];
  else return info;

  let tags: Record<string, string> = {};
  try {
    tags = await overpassTags(osmType, osmId);
    const color = parseColor(tags["osmc:symbol"] ?? "");
    if (color) info.trail_color = color;
    const networkMap: Record<string, string> = { lwn: "local", rwn: "regional", nwn: "national" };
    if (tags.network) info.network = networkMap[tags.network] ?? tags.network;
    if (tags.ref) info.ref = tags.ref;
    if (tags.description) info.description = tags.description;
    if (tags.from) info.trailhead_from = tags.from;
    if (tags.to) info.trailhead_to = tags.to;
    if (tags.distance) {
      const d = parseFloat(tags.distance.replace("km", "").trim());
      if (!Number.isNaN(d)) info.distance_km = d;
    }
    if (tags.ascent && !Number.isNaN(parseInt(tags.ascent))) info.elevation_gain_m = parseInt(tags.ascent);
    if (tags.descent && !Number.isNaN(parseInt(tags.descent))) info.elevation_loss_m = parseInt(tags.descent);
    if (tags.operator) info.operator = tags.operator;
    if (tags.website || tags.url) info.website = tags.website || tags.url;
  } catch {
    /* tags best-effort */
  }

  let coords: Pt[] = [];
  try {
    coords = await overpassGeometry(osmType, osmId);
    if (coords.length) {
      info.trailhead_coords = {
        lat: Math.round(coords[0][0] * 1e6) / 1e6,
        lng: Math.round(coords[0][1] * 1e6) / 1e6,
      };
      info.start_maps = `https://www.google.com/maps?q=${coords[0][0]},${coords[0][1]}`;
    }
  } catch {
    /* geometry best-effort */
  }

  let routed = null;
  if (!("distance_km" in info) && coords.length >= 2) {
    try {
      await new Promise((r) => setTimeout(r, ROUTING_MIN_GAP));
      routed = await routingDistanceElevation(coords[0], coords[coords.length - 1]);
    } catch {
      /* fall back below */
    }
  }
  if (routed) {
    info.distance_km = routed.distance_km;
    info.elevation_gain_m = routed.elevation_gain_m;
    info.elevation_loss_m = routed.elevation_loss_m;
  } else if (!("distance_km" in info) && coords.length >= 2) {
    info.distance_km = totalDistanceKm(coords);
  }

  const dist = info.distance_km ?? 0;
  const gain = info.elevation_gain_m ?? 0;
  if (dist) {
    if (!("difficulty" in info)) info.difficulty = classifyDifficulty(dist, gain);
    info.estimated_duration = estimateDuration(dist, gain);
  }
  info.car_logistics = carLogistics(tags, coords);
  return info;
}

function toTrail(t: TrailRow) {
  return {
    name: t.name_he,
    subtitle: t.subtitle,
    region: t.region_he ?? t.area_he ?? undefined,
    difficulty: t.difficulty,
    difficulty_level: t.difficulty_level ?? undefined,
    distance_km: t.distance_km ?? undefined,
    duration: t.duration,
    features: t.features ?? undefined,
    description: t.description_he,
    waze: t.waze_link,
    start_maps: mapsLink(t.lat, t.lng),
    tiuli_url: t.url,
    trail_map_image: t.trail_map_image,
    coordinates: t.lat != null && t.lng != null ? { lat: t.lat, lng: t.lng } : undefined,
    match_score: t.similarity != null ? Math.round(t.similarity * 100) / 100 : undefined,
  };
}

class TrailService {
  /**
   * Primary source: the curated tiuli catalog in Supabase.
   *
   * Semantic + filtered: embeds `query` and ranks by similarity, after hard-filtering
   * on region / distance / difficulty / features. Falls back to trigram text search
   * when embeddings are unavailable or the filtered semantic search finds nothing.
   */
  async searchCatalog(query: string, opts: TrailFilters & { limit?: number } = {}) {
    const limit = Math.max(1, Math.min(20, opts.limit ?? 5));
    const filters: TrailFilters = {
      // Resolve "Golan"/"North"/etc. → the Hebrew token the catalog stores.
      region: normalizeRegion(opts.region),
      maxKm: opts.maxKm,
      minKm: opts.minKm,
      difficultyMax: opts.difficultyMax,
      features: opts.features,
    };
    const hasFilters =
      filters.region != null ||
      filters.maxKm != null ||
      filters.minKm != null ||
      filters.difficultyMax != null ||
      (filters.features?.length ?? 0) > 0;

    const embedding = await embedQuery(query);
    if (embedding) {
      const rows = await trailDbService.matchSemantic(embedding, filters, limit);
      if (rows.length > 0) return { trails: rows.map(toTrail), matched_by: "semantic" };
      if (hasFilters) {
        // Filters may have excluded everything (e.g. no ≤5 km trail in that region).
        return {
          trails: [],
          note: `No catalog trail matched the filters for "${query}". Relax the distance/difficulty/region constraints or try search_trails.`,
        };
      }
    }

    // Fallback: plain text search (no key, embedding error, or no semantic hits).
    const rows = await trailDbService.search(query, limit);
    if (rows.length === 0) return { trails: [], note: `No catalog trail matched "${query}".` };
    return { trails: rows.map(toTrail), matched_by: "text" };
  }

  /** Secondary source: Israel Hiking Map / Overpass geographic search. */
  async searchOSM(query: string, max = 3, language: "en" | "he" = "en") {
    const trails = await ihmSearch(query, language, Math.min(max, 5));
    if (trails.length === 0) return { trails: [] };
    const enriched = await Promise.all(trails.map((t) => enrichOsm(t)));
    for (const t of enriched) {
      if ((t.distance_km ?? 0) > DEFAULT_MAX_KM) {
        // Unordered OSM relation geometry inflates distance — drop the numbers.
        t.long_distance_route = true;
        delete t.distance_km;
        delete t.estimated_duration;
      }
    }
    return { trails: enriched };
  }
}

export const trailService = new TrailService();
