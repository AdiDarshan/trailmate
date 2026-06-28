// searchTiuli — query the curated tiuli trail catalog in Supabase.
//
// This replaces the Python live-scrape (get_tiuli_trail.py). The catalog of
// 348 trails is pre-enriched and stored in the `trails` table, so the agent
// searches structured data instead of fetching+parsing pages at query time.

import { supabase } from "../supabase";
import type { ToolDef } from "./types";

// Build a Google Maps link from coordinates (the UI expects maps URLs).
function mapsLink(lat: number | null, lng: number | null): string | undefined {
  if (lat == null || lng == null) return undefined;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export const searchTiuli: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "search_tiuli",
      description:
        "Search TrailMate's curated catalog of 348 real Israeli hiking trails " +
        "(from tiuli.com), each with a Hebrew description, Waze navigation link, " +
        "trailhead coordinates, difficulty, and duration. Use this as the primary " +
        "trail source when recommending hikes. The catalog is in Hebrew — pass " +
        "Hebrew place names when possible (e.g. 'גליל' for Galilee, 'עין גדי' for " +
        "Ein Gedi); English also works for transliterated names.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Trail name, region, or keyword. Hebrew preferred, e.g. 'נחל ערוגות', 'כרמל'.",
          },
          limit: { type: "integer", description: "Max trails to return (default 5)." },
        },
        required: ["query"],
      },
    },
  },
  async execute(args: Record<string, any>) {
    const query = String(args.query ?? "").trim();
    if (!query) return { status: "error", message: "query is required" };
    const limit = Math.max(1, Math.min(20, Number(args.limit ?? 5)));

    // Match across name, subtitle, and description. ilike with trigram indexes
    // keeps this fast over 348 rows.
    const pattern = `%${query}%`;
    const { data, error } = await supabase
      .from("trails")
      .select(
        "id,name_he,subtitle,url,description_he,waze_link,lat,lng,difficulty,duration,trail_map_image",
      )
      .or(
        `name_he.ilike.${pattern},subtitle.ilike.${pattern},description_he.ilike.${pattern}`,
      )
      .limit(limit);

    if (error) return { status: "error", message: error.message };
    if (!data || data.length === 0) {
      return { status: "success", trails: [], note: `No catalog trail matched "${query}".` };
    }

    const trails = data.map((t) => ({
      name: t.name_he,
      subtitle: t.subtitle,
      difficulty: t.difficulty,
      duration: t.duration,
      description: t.description_he,
      waze: t.waze_link,
      start_maps: mapsLink(t.lat, t.lng),
      tiuli_url: t.url,
      trail_map_image: t.trail_map_image,
      coordinates: t.lat != null && t.lng != null ? { lat: t.lat, lng: t.lng } : undefined,
    }));
    return { status: "success", trails };
  },
};
