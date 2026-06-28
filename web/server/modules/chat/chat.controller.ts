// Chat controller — HTTP adapter. Parses the request, resolves the user, loads
// the currently-open trip (if any) for edit context, drives ChatService, and
// streams the agent events back as NDJSON.

import { chatService } from "./chat.service";
import { tripService } from "../trip/trip.service";
import { getAuthUser } from "../../db/supabase-auth";
import type { ChatMessage, Itinerary } from "../../shared/types";

class ChatController {
  async handle(req: Request): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return new Response("Unauthorized", { status: 401 });

    let messages: ChatMessage[];
    let tripId: string | null = null;
    try {
      const body = await req.json();
      messages = Array.isArray(body?.messages) ? body.messages : [];
      tripId = typeof body?.tripId === "string" ? body.tripId : null;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (messages.length === 0) {
      return new Response("messages is required", { status: 400 });
    }

    // If a saved trip is open, load it so the agent can edit it in place.
    let currentTrip: Itinerary | null = null;
    if (tripId) {
      currentTrip = await tripService.load(tripId, user.id);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of chatService.run(messages, currentTrip)) {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          }
        } catch (e: any) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "error", message: String(e?.message ?? e) }) + "\n"),
          );
        } finally {
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
}

export const chatController = new ChatController();
