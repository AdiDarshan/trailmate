// Data access for chat_sessions / chat_messages. All calls run on the
// request's RLS-bound client, so Postgres enforces "your own sessions only".
//
// Session model: the "current chat" is the newest session with no trip_id.
// Saving a trip stamps trip_id onto its session (the only way an old chat
// stays reachable). `itinerary` carries the last presented-but-unsaved plan.
//
// Every query is wrapped in log.timed → one structured record with latency and
// outcome per DB call; failures throw AppError with a user-safe message.

import { nanoid } from "nanoid";
import { createAuthClient } from "../../db/supabase-auth";
import { AppError } from "../../shared/errors";
import { createLogger } from "../../shared/logger";
import type { ChatMessage, Itinerary } from "../../shared/types";

const SESSION_ID_LENGTH = 12;
const SESSION_COLS = "id,trip_id,itinerary";
const PUBLIC_DB_ERROR = "Could not access your conversation. Please try again.";

const log = createLogger("chat.dbservice");

export interface ChatSession {
  id: string;
  trip_id: string | null;
  itinerary: Itinerary | null;
}

/** Wrap a Supabase {data,error} result: typed throw on error. */
function unwrap<T>(op: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) {
    throw new AppError(`${op}: ${result.error.message}`, { publicMessage: PUBLIC_DB_ERROR });
  }
  return result.data;
}

class ChatDbService {
  /** The user's current chat — newest session not attached to a trip. */
  async getCurrentSession(userId: string): Promise<ChatSession | null> {
    return log.timed("get_current_session", { userId }, async () => {
      const db = await createAuthClient();
      const res = await db
        .from("chat_sessions")
        .select(SESSION_COLS)
        .eq("user_id", userId)
        .is("trip_id", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (unwrap("get_current_session", res) as ChatSession | null) ?? null;
    });
  }

  /** The session attached to a saved trip, if any. */
  async getSessionByTrip(userId: string, tripId: string): Promise<ChatSession | null> {
    return log.timed("get_session_by_trip", { userId, tripId }, async () => {
      const db = await createAuthClient();
      const res = await db
        .from("chat_sessions")
        .select(SESSION_COLS)
        .eq("user_id", userId)
        .eq("trip_id", tripId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (unwrap("get_session_by_trip", res) as ChatSession | null) ?? null;
    });
  }

  /** One owned session by id (RLS returns nothing for foreign sessions). */
  async getSession(id: string, userId: string): Promise<ChatSession | null> {
    return log.timed("get_session", { sessionId: id, userId }, async () => {
      const db = await createAuthClient();
      const res = await db
        .from("chat_sessions")
        .select(SESSION_COLS)
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      return (unwrap("get_session", res) as ChatSession | null) ?? null;
    });
  }

  async createSession(userId: string, tripId: string | null = null): Promise<ChatSession> {
    const id = nanoid(SESSION_ID_LENGTH);
    return log.timed("create_session", { sessionId: id, userId, tripId }, async () => {
      const db = await createAuthClient();
      const res = await db.from("chat_sessions").insert({ id, user_id: userId, trip_id: tripId });
      unwrap("create_session", res);
      return { id, trip_id: tripId, itinerary: null };
    });
  }

  /** A session's visible conversation, oldest first. */
  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    return log.timed("list_messages", { sessionId }, async () => {
      const db = await createAuthClient();
      const res = await db
        .from("chat_messages")
        .select("role,content")
        .eq("session_id", sessionId)
        .order("id", { ascending: true });
      return (unwrap("list_messages", res) ?? []) as ChatMessage[];
    });
  }

  async addMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<void> {
    return log.timed("add_message", { sessionId, role, contentLen: content.length }, async () => {
      const db = await createAuthClient();
      unwrap("add_message", await db.from("chat_messages").insert({ session_id: sessionId, role, content }));
      // Bump recency so this session stays the "current chat". Best-effort:
      // a failed bump only affects which chat restores as current.
      const bump = await db
        .from("chat_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sessionId);
      if (bump.error) log.warn("touch_session_failed", { sessionId, error: bump.error.message });
    });
  }

  /** Store (or clear) the last presented-but-unsaved plan. */
  async setItinerary(sessionId: string, itinerary: Itinerary | null): Promise<void> {
    return log.timed("set_itinerary", { sessionId, hasItinerary: !!itinerary }, async () => {
      const db = await createAuthClient();
      unwrap("set_itinerary", await db.from("chat_sessions").update({ itinerary }).eq("id", sessionId));
    });
  }

  /** Discard a draft: delete the session (messages cascade in the DB). The
   *  trip_id-null guard means a saved trip's chat can never be deleted here. */
  async deleteDraftSession(id: string, userId: string): Promise<void> {
    return log.timed("delete_draft_session", { sessionId: id, userId }, async () => {
      const db = await createAuthClient();
      unwrap(
        "delete_draft_session",
        await db.from("chat_sessions").delete().eq("id", id).eq("user_id", userId).is("trip_id", null),
      );
    });
  }

  /** Attach a session to a saved trip; the saved plan now lives in trips.data. */
  async linkTrip(sessionId: string, tripId: string): Promise<void> {
    return log.timed("link_trip", { sessionId, tripId }, async () => {
      const db = await createAuthClient();
      unwrap(
        "link_trip",
        await db.from("chat_sessions").update({ trip_id: tripId, itinerary: null }).eq("id", sessionId),
      );
    });
  }
}

export const chatDbService = new ChatDbService();
