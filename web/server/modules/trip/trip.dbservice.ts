// Data access for the `trips` table. No business logic — just CRUD. User-scoped
// methods filter by user_id (enforced in code; RLS is defense-in-depth).

import { supabase } from "../../db/supabase";
import type { Itinerary, TripSummary } from "../../shared/types";

interface TripRecord {
  id: string;
  user_id: string;
  title: string;
  dates: string | null;
  start_date: string | null;
  data: Itinerary;
}

export interface TripWithMeta {
  start_date: string | null;
  data: Itinerary;
}

class TripDbService {
  /** Insert or update a trip (owner-stamped). */
  async upsert(record: TripRecord): Promise<void> {
    const { error } = await supabase.from("trips").upsert(record);
    if (error) throw new Error(error.message);
  }

  /** A user's trips, newest first, for the sidebar. */
  async listByUser(userId: string): Promise<TripSummary[]> {
    const { data, error } = await supabase
      .from("trips")
      .select("id,title,dates,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, title: r.title, dates: r.dates ?? undefined }));
  }

  /** Load a trip only if it belongs to the user. */
  async getByIdForUser(id: string, userId: string): Promise<Itinerary | null> {
    const { data, error } = await supabase
      .from("trips")
      .select("data")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return data.data as Itinerary;
  }

  /** All of a user's trips with start_date — used by the reminder scheduler. */
  async listByUserWithMeta(userId: string): Promise<Array<{ id: string } & TripWithMeta>> {
    const { data, error } = await supabase
      .from("trips")
      .select("id,start_date,data")
      .eq("user_id", userId)
      .not("start_date", "is", null);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      start_date: r.start_date ?? null,
      data: r.data as Itinerary,
    }));
  }

  /** Itinerary + machine start_date — used by the reminder scheduler (system). */
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
