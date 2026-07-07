// Chat controller — HTTP adapter. The server owns conversation history:
// the client sends only its new message plus a session id, we load the rest
// from chat_sessions/chat_messages, drive ChatService, stream the agent
// events back as NDJSON, and persist the turn's outcome.
//
// Error hygiene: internal detail (stack, DB messages) goes to structured logs;
// clients only ever receive AppError.publicMessage or a generic message.

import { chatService } from "./chat.service";
import { chatDbService, type ChatSession } from "./chat.dbservice";
import { tripService } from "../trip/trip.service";
import { getAuthUser } from "../../db/supabase-auth";
import { toPublicMessage } from "../../shared/errors";
import { createLogger, errInfo } from "../../shared/logger";
import type { ChatMessage, Itinerary } from "../../shared/types";

const log = createLogger("chat.controller");

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache",
} as const;

class ChatController {
  /** POST /api/chat — body { content, sessionId?, tripId? }. */
  async handle(req: Request): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return new Response("Unauthorized", { status: 401 });

    let content: string;
    let sessionId: string | null = null;
    let tripId: string | null = null;
    try {
      const body = await req.json();
      content = typeof body?.content === "string" ? body.content.trim() : "";
      sessionId = typeof body?.sessionId === "string" ? body.sessionId : null;
      tripId = typeof body?.tripId === "string" ? body.tripId : null;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!content) return new Response("content is required", { status: 400 });

    log.info("chat_request", {
      userId: user.id,
      sessionId,
      tripId,
      contentLen: content.length,
    });

    // Resolve the conversation, load its history, and persist the user's
    // message — all before the stream starts, so failures here return a real
    // HTTP status instead of a broken stream.
    let session: ChatSession;
    let history: ChatMessage[];
    let currentTrip: Itinerary | null = null;
    try {
      session = await this.resolveSession(user.id, sessionId, tripId);
      history = await chatDbService.listMessages(session.id);
      history.push({ role: "user", content });
      await chatDbService.addMessage(session.id, "user", content);

      // Edit context: an open saved trip, or the session's presented-but-
      // unsaved plan (so a refresh doesn't make the agent forget what it
      // just proposed).
      if (tripId) currentTrip = await tripService.load(tripId, user.id);
      if (!currentTrip) currentTrip = session.itinerary;
    } catch (e) {
      if ((e as any)?.name === "SessionNotFound") {
        return new Response("Session not found", { status: 404 });
      }
      log.error("chat_setup_failed", { userId: user.id, sessionId, tripId, ...errInfo(e) });
      return Response.json({ error: toPublicMessage(e) }, { status: 500 });
    }

    const activeSession = session;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // First event tells the client which session to continue.
        controller.enqueue(encoder.encode(JSON.stringify({ type: "session", id: activeSession.id }) + "\n"));
        let assistantText = "";
        try {
          for await (const event of chatService.run(history, currentTrip)) {
            if (event.type === "text") assistantText += event.v;
            if (event.type === "itinerary") {
              await chatDbService.setItinerary(activeSession.id, event.data);
            }
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          }
        } catch (e) {
          log.error("chat_stream_failed", { sessionId: activeSession.id, ...errInfo(e) });
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "error", message: toPublicMessage(e) }) + "\n"),
          );
        } finally {
          // Persist the visible reply (planning turns stream no prose — the
          // outcome of those lives in the session's itinerary instead).
          if (assistantText.trim()) {
            await chatDbService
              .addMessage(activeSession.id, "assistant", assistantText)
              .catch((e) =>
                log.error("assistant_persist_failed", { sessionId: activeSession.id, ...errInfo(e) }),
              );
          }
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: NDJSON_HEADERS });
  }

  /** GET /api/chat/session[?tripId=] — restore the current chat, or the chat
   *  attached to a saved trip. Never lists other sessions. */
  async session(req: Request): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const tripId = new URL(req.url).searchParams.get("tripId");
    try {
      const session = tripId
        ? await chatDbService.getSessionByTrip(user.id, tripId)
        : await chatDbService.getCurrentSession(user.id);

      if (!session) return Response.json({ sessionId: null, messages: [], itinerary: null });

      const messages = await chatDbService.listMessages(session.id);
      return Response.json({ sessionId: session.id, messages, itinerary: session.itinerary });
    } catch (e) {
      log.error("session_restore_failed", { userId: user.id, tripId, ...errInfo(e) });
      return Response.json({ error: toPublicMessage(e) }, { status: 500 });
    }
  }

  /** No session id → fresh chat (or first message about a trip with no chat yet). */
  private async resolveSession(
    userId: string,
    sessionId: string | null,
    tripId: string | null,
  ): Promise<ChatSession> {
    if (sessionId) {
      const session = await chatDbService.getSession(sessionId, userId);
      if (!session) {
        const notFound = new Error(`session ${sessionId} not found for user`);
        notFound.name = "SessionNotFound";
        throw notFound;
      }
      return session;
    }
    if (tripId) {
      return (
        (await chatDbService.getSessionByTrip(userId, tripId)) ??
        (await chatDbService.createSession(userId, tripId))
      );
    }
    return chatDbService.createSession(userId);
  }
}

export const chatController = new ChatController();
