// Data access for the `trips` table. No business logic — just CRUD.

import { supabase } from "../../db/supabase";
import type { Itinerary } from "../../shared/types";

interface TripRecord {
  id: string;
  title: string;
  dates: string | null;
  start_date: string | null; // ISO YYYY-MM-DD, for the reminder scheduler
  data: Itinerary;
}

export interface TripWithMeta {
  start_date: string | null;
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

  /** Itinerary plus the machine start_date — used by the reminder scheduler. */
  async getWithMeta(id: string): Promise<TripWithMeta | null> {
    const { data, error } = await supabase
      .from("trips")
      .select("start_date,data")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return { start_date: data.start_date ?? null, data: data.data as Itinerary };
  }
}

export const tripDbService = new TripDbService();
