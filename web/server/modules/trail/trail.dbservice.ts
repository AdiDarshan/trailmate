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
  duration: string | null;
  trail_map_image: string | null;
}

const COLUMNS =
  "id,name_he,subtitle,url,description_he,waze_link,lat,lng,difficulty,duration,trail_map_image";

class TrailDbService {
  /** Full-text-ish search across name, subtitle, and description. */
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
}

export const trailDbService = new TrailDbService();
