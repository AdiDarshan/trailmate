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
  // Whether the agent did real planning this turn — used to decide if we should
  // force a save_trip the model forgot to call (so the notebook always fills).
  let usedPlanningTool = false;
  const PLANNING_TOOLS = new Set(["search_tiuli", "search_trails", "search_places"]);

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
        if (PLANNING_TOOLS.has(c.name)) usedPlanningTool = true;
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
    // Reliability net: if the agent clearly planned a trip but forgot to call
    // save_trip, force one call so the notebook always populates.
    if (!savedTripId && usedPlanningTool) {
      messages.push({ role: "assistant", content });
      savedTripId = await forceSaveTrip(client, messages);
    }
    if (savedTripId) yield { type: "trip", id: savedTripId };
    yield { type: "done" };
    return;

    void finish;
  }

  yield { type: "error", message: "Agent exceeded maximum execution depth." };
  yield { type: "done" };
}

// Make one forced save_trip call so a planned itinerary always reaches the
// notebook, even when the model neglected to call the tool itself. The model
// extracts the structured fields from the conversation it just produced.
async function forceSaveTrip(
  client: OpenAI,
  messages: ChatParam[],
): Promise<string | null> {
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Now save the itinerary you just presented by calling save_trip with " +
            "the structured day-by-day data. Do not write anything else.",
        },
      ],
      tools: TOOL_SCHEMAS,
      tool_choice: { type: "function", function: { name: "save_trip" } },
    });
    const call = res.choices[0]?.message?.tool_calls?.[0];
    if (!call) return null;
    let parsed: Record<string, any> = {};
    try {
      parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      return null;
    }
    const result = await executeTool("save_trip", parsed);
    if (result && typeof result === "object" && (result as any).trip_id) {
      return (result as any).trip_id;
    }
    return null;
  } catch {
    return null;
  }
}
