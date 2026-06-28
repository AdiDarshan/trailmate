// Data access for the `trips` table. No business logic — just CRUD.

import { supabase } from "../../db/supabase";
import type { Itinerary } from "../../shared/types";

interface TripRecord {
  id: string;
  title: string;
  dates: string | null;
  data: Itinerary;
}

class TripDbService {
  async insert(record: TripRecord): Promise<void> {
    const { error } = await supabase.from("trips").insert(record);
    if (error) throw new Error(error.message);
  }

  async getById(id: string): Promise<Itinerary | null> {
    const { data, error } = await supabase
      .from("trips")
      .select("data")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return data.data as Itinerary;
  }
}

export const tripDbService = new TripDbService();
