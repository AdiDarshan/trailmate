// Data access for the `trips` table.
//
// User-facing reads/writes go through the request's RLS-bound client (the
// signed-in user's session), so Postgres enforces "you can only touch your own
// trips" at the database — not just in app code. System tasks (the reminder
// cron, which has no user session) use the service-role client.
//
// Every query is wrapped in log.timed → structured latency/outcome records;
// failures throw AppError with a user-safe message.

import { supabase } from "../../db/supabase";
import { createAuthClient } from "../../db/supabase-auth";
import { AppError } from "../../shared/errors";
import { createLogger } from "../../shared/logger";
import type { Itinerary, TripSummary } from "../../shared/types";

const PUBLIC_DB_ERROR = "Could not access your trips. Please try again.";

const log = createLogger("trip.dbservice");

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

/** Wrap a Supabase {data,error} result: typed throw on error. */
function unwrap<T>(op: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) {
    throw new AppError(`${op}: ${result.error.message}`, { publicMessage: PUBLIC_DB_ERROR });
  }
  return result.data;
}

class TripDbService {
  // ── User-scoped (RLS-enforced) ───────────────────────────────────────────

  /** Insert or update a trip as the signed-in user (RLS checks ownership). */
  async upsert(record: TripRecord): Promise<void> {
    return log.timed("upsert_trip", { tripId: record.id, userId: record.user_id }, async () => {
      const db = await createAuthClient();
      unwrap("upsert_trip", await db.from("trips").upsert(record));
    });
  }

  /** The signed-in user's trips, newest first. RLS guarantees isolation. */
  async listByUser(userId: string): Promise<TripSummary[]> {
    return log.timed("list_trips", { userId }, async () => {
      const db = await createAuthClient();
      const rows = unwrap(
        "list_trips",
        await db
          .from("trips")
          .select("id,title,dates,created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
      );
      return (rows ?? []).map((r) => ({ id: r.id, title: r.title, dates: r.dates ?? undefined }));
    });
  }

  /** Load a trip the signed-in user owns (RLS returns nothing otherwise). */
  async getByIdForUser(id: string, userId: string): Promise<Itinerary | null> {
    return log.timed("get_trip", { tripId: id, userId }, async () => {
      const db = await createAuthClient();
      const res = await db.from("trips").select("data").eq("id", id).eq("user_id", userId).maybeSingle();
      // Not-found and error both surface as null to callers (existing
      // contract: 404 at the HTTP layer) — but errors get logged via unwrap.
      if (res.error) {
        log.warn("get_trip_error", { tripId: id, error: res.error.message });
        return null;
      }
      return (res.data?.data as Itinerary) ?? null;
    });
  }

  // ── System-scoped (service-role; no user session) ────────────────────────

  /** All of a user's trips with start_date — used by the reminder scheduler. */
  async listByUserWithMeta(userId: string): Promise<Array<{ id: string } & TripWithMeta>> {
    return log.timed("list_trips_meta", { userId }, async () => {
      const rows = unwrap(
        "list_trips_meta",
        await supabase
          .from("trips")
          .select("id,start_date,data")
          .eq("user_id", userId)
          .not("start_date", "is", null),
      );
      return (rows ?? []).map((r) => ({
        id: r.id,
        start_date: r.start_date ?? null,
        data: r.data as Itinerary,
      }));
    });
  }

  /** Itinerary + machine start_date for one trip — reminder scheduler (system). */
  async getWithMeta(id: string): Promise<TripWithMeta | null> {
    return log.timed("get_trip_meta", { tripId: id }, async () => {
      const res = await supabase.from("trips").select("start_date,data").eq("id", id).single();
      if (res.error || !res.data) {
        if (res.error) log.warn("get_trip_meta_error", { tripId: id, error: res.error.message });
        return null;
      }
      return { start_date: res.data.start_date ?? null, data: res.data.data as Itinerary };
    });
  }
}

export const tripDbService = new TripDbService();
