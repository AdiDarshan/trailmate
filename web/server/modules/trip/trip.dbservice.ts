// Data access for the `trips` table.
//
// User-facing reads/writes go through the request's RLS-bound client (the
// signed-in user's session), so Postgres enforces "you can only touch your own
// trips" at the database — not just in app code. System tasks (the reminder
// cron, which has no user session) use the service-role client.

import { supabase } from "../../db/supabase";
import { createAuthClient } from "../../db/supabase-auth";
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
  // ── User-scoped (RLS-enforced) ───────────────────────────────────────────

  /** Insert or update a trip as the signed-in user (RLS checks ownership). */
  async upsert(record: TripRecord): Promise<void> {
    const db = await createAuthClient();
    const { error } = await db.from("trips").upsert(record);
    if (error) throw new Error(error.message);
  }

  /** The signed-in user's trips, newest first. RLS guarantees isolation. */
  async listByUser(userId: string): Promise<TripSummary[]> {
    const db = await createAuthClient();
    const { data, error } = await db
      .from("trips")
      .select("id,title,dates,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, title: r.title, dates: r.dates ?? undefined }));
  }

  /** Load a trip the signed-in user owns (RLS returns nothing otherwise). */
  async getByIdForUser(id: string, userId: string): Promise<Itinerary | null> {
    const db = await createAuthClient();
    const { data, error } = await db
      .from("trips")
      .select("data")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return data.data as Itinerary;
  }

  // ── System-scoped (service-role; no user session) ────────────────────────

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

  /** Itinerary + machine start_date for one trip — reminder scheduler (system). */
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
