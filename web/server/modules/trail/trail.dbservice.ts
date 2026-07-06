// Data access for the `trails` catalog. No business logic — just queries.

import { supabase } from "../../db/supabase";

export interface TrailRow {
  id: number;
  name_he: string;
  subtitle: string | null;
  url: string | null;
  description_he: string | null;
  waze_link: string | null;
  lat: number | null;
  lng: number | null;
  difficulty: string | null;
  difficulty_level?: number | null;
  distance_km?: number | null;
  duration: string | null;
  trail_map_image: string | null;
  area_he?: string | null;
  region_he?: string | null;
  subregion_he?: string | null;
  city_he?: string | null;
  features?: string[] | null;
  similarity?: number;
}

/** Hard filters for match_trails. All optional; omit to skip. */
export interface TrailFilters {
  region?: string;
  maxKm?: number;
  minKm?: number;
  difficultyMax?: number;
  features?: string[];
}

const COLUMNS =
  "id,name_he,subtitle,url,description_he,waze_link,lat,lng,difficulty,duration,trail_map_image";

class TrailDbService {
  /** Full-text-ish search across name, subtitle, and description (fallback path). */
  async search(query: string, limit: number): Promise<TrailRow[]> {
    const pattern = `%${query}%`;
    const { data, error } = await supabase
      .from("trails")
      .select(COLUMNS)
      .or(
        `name_he.ilike.${pattern},subtitle.ilike.${pattern},description_he.ilike.${pattern}`,
      )
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as TrailRow[];
  }

  /**
   * Semantic search via the match_trails RPC: hard-filter on region/distance/
   * difficulty/features, then rank survivors by cosine similarity to the query
   * embedding. Empty `features` and undefined filters are passed as null (skipped).
   */
  async matchSemantic(
    embedding: number[],
    filters: TrailFilters,
    limit: number,
  ): Promise<TrailRow[]> {
    const { data, error } = await supabase.rpc("match_trails", {
      query_embedding: embedding,
      match_count: limit,
      filter_region: filters.region ?? null,
      max_km: filters.maxKm ?? null,
      min_km: filters.minKm ?? null,
      difficulty_max: filters.difficultyMax ?? null,
      required_features: filters.features?.length ? filters.features : null,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as TrailRow[];
  }
}

export const trailDbService = new TrailDbService();
