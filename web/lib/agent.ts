// The TrailMate agent loop, ported from the Python AIService.run().
//
// Bounded tool-calling loop over OpenAI chat completions. Streams the final
// answer's tokens as they arrive and, if the agent saved a trip, emits the
// resulting tripId so the client can load the notebook.
//
// Yields AgentEvent objects; the route handler serialises them as NDJSON.

import OpenAI from "openai";
import { buildSystemPrompt } from "./prompt";
import { TOOL_SCHEMAS, executeTool } from "./tools";
import type { ChatMessage } from "./types";

const MODEL = "gpt-4o";
const MAX_ITERATIONS = 10;

export type AgentEvent =
  | { type: "text"; v: string }
  | { type: "trip"; id: string }
  | { type: "error"; message: string }
  | { type: "done" };

type ChatParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export async function* runAgent(history: ChatMessage[]): AsyncGenerator<AgentEvent> {
  const client = new OpenAI();

  const messages: ChatParam[] = [
    { role: "system", content: buildSystemPrompt() },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatParam),
  ];

  let savedTripId: string | null = null;

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOL_SCHEMAS,
      stream: true,
    });

    let content = "";
    // Accumulate tool-call deltas by index across stream chunks.
    const toolCalls: Record<number, { id: string; name: string; args: string }> = {};
    let finish: string | null = null;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;

      if (delta?.content) {
        content += delta.content;
        // Stream every text delta immediately. In practice gpt-4o emits either
        // text OR tool_calls in a given round; a preamble like "Let me check the
        // weather…" before a tool call is fine to show the user.
        yield { type: "text", v: delta.content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const slot = (toolCalls[idx] ??= { id: "", name: "", args: "" });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    const calls = Object.values(toolCalls);

    if (calls.length > 0) {
      // Persist the assistant turn (with tool_calls), then run each tool.
      messages.push({
        role: "assistant",
        content: content || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.args || "{}" },
        })),
      });

      for (const c of calls) {
        let parsed: Record<string, any> = {};
        try {
          parsed = c.args ? JSON.parse(c.args) : {};
        } catch {
          parsed = {};
        }
        const result = await executeTool(c.name, parsed);
        if (
          c.name === "save_trip" &&
          result &&
          typeof result === "object" &&
          (result as any).trip_id
        ) {
          savedTripId = (result as any).trip_id;
        }
        messages.push({
          role: "tool",
          tool_call_id: c.id,
          content: JSON.stringify(result),
        });
      }
      continue; // next iteration: let the model react to tool results
    }

    // No tool calls → the streamed content above was the final answer.
    if (savedTripId) yield { type: "trip", id: savedTripId };
    yield { type: "done" };
    return;

    void finish;
  }

  yield { type: "error", message: "Agent exceeded maximum execution depth." };
  yield { type: "done" };
}
