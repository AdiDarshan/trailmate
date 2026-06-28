// searchTrails — Israel Hiking Map 3-API enrichment. Ported from
// .agents/skills/search-israel-trails/scripts/search_trails.py.
//
// Secondary geographic trail search (the tiuli catalog is primary). Returns
// real OSM trail routes with distance, elevation, difficulty, and duration.
// No API key required.

import type { ToolDef } from "./types";

const DEFAULT_MAX = 3;
const DEFAULT_MAX_KM = 30;
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const IHM_BASE = "https://israelhiking.osm.org.il/api";
const ROUTING_MIN_GAP = 500; // ms between routing calls
const UA = { "User-Agent": "TrailMate/1.0 (travel planning)" };

type Pt = [number, number]; // [lat, lng]

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
    .filter((r) => String(r.icon ?? "").includes("hike") && String(r.id ?? "").startsWith("relation_"))
    .slice(0, maxResults);
}

async function overpassTags(osmType: string, osmId: string): Promise<Record<string, string>> {
  const data =
    osmType === "relation"
      ? `[out:json];relation(${osmId});out tags;`
      : `[out:json];way(${osmId});out tags;`;
  const resp = await postOverpass(data);
  const els = resp.elements ?? [];
  return els[0]?.tags ?? {};
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

async function enrich(trail: any): Promise<Record<string, any>> {
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

export const searchTrails: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "search_trails",
      description:
        "Secondary geographic trail search via the Israel Hiking Map / OpenStreetMap. " +
        "Use when the tiuli catalog (search_tiuli) has no good match for an area, or " +
        "to get computed distance, elevation, and difficulty for a named OSM trail.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Trail or area name, e.g. 'Yehudiya', 'Arbel'." },
          max: { type: "integer", description: "Max trails (default 3, cap 5)." },
          language: { type: "string", enum: ["en", "he"], description: "Search language. Default en." },
        },
        required: ["query"],
      },
    },
  },
  async execute(args: Record<string, any>) {
    const query = String(args.query ?? "").trim();
    if (!query) return { status: "error", message: "query is required" };
    const maxResults = Math.min(Number(args.max ?? DEFAULT_MAX), 5);
    const language = args.language === "he" ? "he" : "en";
    try {
      const trails = await ihmSearch(query, language, maxResults);
      if (trails.length === 0) return { status: "success", trails: [] };
      const enriched = await Promise.all(trails.map((t) => enrich(t)));
      for (const t of enriched) {
        if ((t.distance_km ?? 0) > DEFAULT_MAX_KM) {
          // OSM relation geometry sums all member ways unordered → inflated
          // distance. Flag and drop the numbers; rely on tiuli instead.
          t.long_distance_route = true;
          delete t.distance_km;
          delete t.estimated_duration;
        }
      }
      return { status: "success", trails: enriched };
    } catch (e: any) {
      return { status: "error", message: String(e?.message ?? e) };
    }
  },
};
