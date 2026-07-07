// Chat controller — HTTP adapter. The server owns conversation history now:
// the client sends only its new message plus a session id, we load the rest
// from chat_sessions/chat_messages, drive ChatService, stream the agent
// events back as NDJSON, and persist the turn's outcome.

import { chatService } from "./chat.service";
import { chatDbService, type ChatSession } from "./chat.dbservice";
import { tripService } from "../trip/trip.service";
import { getAuthUser } from "../../db/supabase-auth";
import type { ChatMessage, Itinerary } from "../../shared/types";

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

    // Resolve the conversation this message belongs to. No session id means a
    // fresh chat (or the first message about a trip that has no chat yet).
    let session: ChatSession | null = null;
    if (sessionId) {
      session = await chatDbService.getSession(sessionId, user.id);
      if (!session) return new Response("Session not found", { status: 404 });
    } else if (tripId) {
      session = (await chatDbService.getSessionByTrip(user.id, tripId)) ?? (await chatDbService.createSession(user.id, tripId));
    } else {
      session = await chatDbService.createSession(user.id);
    }

    const history: ChatMessage[] = await chatDbService.listMessages(session.id);
    history.push({ role: "user", content });
    await chatDbService.addMessage(session.id, "user", content);

    // Edit context: an open saved trip, or the session's presented-but-unsaved
    // plan (so a refresh doesn't make the agent forget what it just proposed).
    let currentTrip: Itinerary | null = null;
    if (tripId) currentTrip = await tripService.load(tripId, user.id);
    if (!currentTrip) currentTrip = session.itinerary;

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
        } catch (e: any) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "error", message: String(e?.message ?? e) }) + "\n"),
          );
        } finally {
          // Persist the visible reply (planning turns stream no prose — the
          // outcome of those lives in the session's itinerary instead).
          if (assistantText.trim()) {
            await chatDbService.addMessage(activeSession.id, "assistant", assistantText).catch(() => {});
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }

  /** GET /api/chat/session[?tripId=] — restore the current chat, or the chat
   *  attached to a saved trip. Never lists other sessions. */
  async session(req: Request): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const tripId = new URL(req.url).searchParams.get("tripId");
    const session = tripId
      ? await chatDbService.getSessionByTrip(user.id, tripId)
      : await chatDbService.getCurrentSession(user.id);

    if (!session) return Response.json({ sessionId: null, messages: [], itinerary: null });

    const messages = await chatDbService.listMessages(session.id);
    return Response.json({ sessionId: session.id, messages, itinerary: session.itinerary });
  }
}

export const chatController = new ChatController();
