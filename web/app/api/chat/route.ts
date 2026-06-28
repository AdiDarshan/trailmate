// POST /api/chat — runs the agent loop and streams NDJSON events back.
// Body: { messages: ChatMessage[] }  (full conversation, oldest first)

import { runAgent } from "@/lib/agent";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
// Trip planning makes several LLM + external API calls; give it room. Vercel
// Hobby caps at 60s — upgrade to Pro (Fluid Compute) for heavier trips.
export const maxDuration = 60;

export async function POST(req: Request) {
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
        for await (const event of runAgent(messages)) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (e: any) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: "error", message: String(e?.message ?? e) }) + "\n",
          ),
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
