// Chat controller — HTTP adapter. Parses the request, drives ChatService, and
// streams the agent events back as NDJSON. No business logic here.

import { chatService } from "./chat.service";
import type { ChatMessage } from "../../shared/types";

class ChatController {
  async handle(req: Request): Promise<Response> {
    let messages: ChatMessage[];
    try {
      const body = await req.json();
      messages = Array.isArray(body?.messages) ? body.messages : [];
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (messages.length === 0) {
      return new Response("messages is required", { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of chatService.run(messages)) {
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
