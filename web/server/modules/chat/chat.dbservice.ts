// Data access for chat_sessions / chat_messages. All calls run on the
// request's RLS-bound client, so Postgres enforces "your own sessions only".
//
// Session model: the "current chat" is the newest session with no trip_id.
// Saving a trip stamps trip_id onto its session (the only way an old chat
// stays reachable). `itinerary` carries the last presented-but-unsaved plan.

import { nanoid } from "nanoid";
import { createAuthClient } from "../../db/supabase-auth";
import type { ChatMessage, Itinerary } from "../../shared/types";

export interface ChatSession {
  id: string;
  trip_id: string | null;
  itinerary: Itinerary | null;
}

const SESSION_COLS = "id,trip_id,itinerary";

class ChatDbService {
  /** The user's current chat — newest session not attached to a trip. */
  async getCurrentSession(userId: string): Promise<ChatSession | null> {
    const db = await createAuthClient();
    const { data, error } = await db
      .from("chat_sessions")
      .select(SESSION_COLS)
      .eq("user_id", userId)
      .is("trip_id", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ChatSession | null) ?? null;
  }

  /** The session attached to a saved trip, if any. */
  async getSessionByTrip(userId: string, tripId: string): Promise<ChatSession | null> {
    const db = await createAuthClient();
    const { data, error } = await db
      .from("chat_sessions")
      .select(SESSION_COLS)
      .eq("user_id", userId)
      .eq("trip_id", tripId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ChatSession | null) ?? null;
  }

  /** One owned session by id (RLS returns nothing for foreign sessions). */
  async getSession(id: string, userId: string): Promise<ChatSession | null> {
    const db = await createAuthClient();
    const { data, error } = await db
      .from("chat_sessions")
      .select(SESSION_COLS)
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ChatSession | null) ?? null;
  }

  async createSession(userId: string, tripId: string | null = null): Promise<ChatSession> {
    const db = await createAuthClient();
    const session = { id: nanoid(12), user_id: userId, trip_id: tripId };
    const { error } = await db.from("chat_sessions").insert(session);
    if (error) throw new Error(error.message);
    return { id: session.id, trip_id: tripId, itinerary: null };
  }

  /** A session's visible conversation, oldest first. */
  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    const db = await createAuthClient();
    const { data, error } = await db
      .from("chat_messages")
      .select("role,content")
      .eq("session_id", sessionId)
      .order("id", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ChatMessage[];
  }

  async addMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<void> {
    const db = await createAuthClient();
    const { error } = await db.from("chat_messages").insert({ session_id: sessionId, role, content });
    if (error) throw new Error(error.message);
    // Bump recency so this session stays the "current chat".
    await db.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);
  }

  /** Store (or clear) the last presented-but-unsaved plan. */
  async setItinerary(sessionId: string, itinerary: Itinerary | null): Promise<void> {
    const db = await createAuthClient();
    const { error } = await db.from("chat_sessions").update({ itinerary }).eq("id", sessionId);
    if (error) throw new Error(error.message);
  }

  /** Attach a session to a saved trip; the saved plan now lives in trips.data. */
  async linkTrip(sessionId: string, tripId: string): Promise<void> {
    const db = await createAuthClient();
    const { error } = await db
      .from("chat_sessions")
      .update({ trip_id: tripId, itinerary: null })
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
  }
}

export const chatDbService = new ChatDbService();
