// Chat business logic — the bounded tool-calling agent loop. Streams the final
// answer's tokens and, if a trip was saved, the resulting tripId. Yields
// AgentEvent objects; the controller serialises them as NDJSON.

import OpenAI from "openai";
import { buildSystemPrompt } from "../../agent/prompt";
import { TOOL_SCHEMAS, PLANNING_TOOLS, executeTool } from "../../agent/tools";
import type { ChatMessage, Itinerary } from "../../shared/types";

const MODEL = "gpt-4o";
const MAX_ITERATIONS = 10;

export type AgentEvent =
  | { type: "text"; v: string }
  | { type: "itinerary"; data: Itinerary }
  | { type: "error"; message: string }
  | { type: "done" };

type ChatParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

class ChatService {
  async *run(history: ChatMessage[], currentTrip: Itinerary | null = null): AsyncGenerator<AgentEvent> {
    const client = new OpenAI();
    const messages: ChatParam[] = [
      { role: "system", content: buildSystemPrompt() },
    ];
    // Edit context: if a saved trip is open, tell the agent so requested changes
    // modify THIS trip (and it re-presents the full updated itinerary).
    if (currentTrip) {
      messages.push({
        role: "system",
        content:
          "The user is currently viewing this saved trip. If they ask for changes, " +
          "modify it and call present_itinerary with the COMPLETE updated itinerary " +
          "(preserve start_date and unchanged days):\n" +
          JSON.stringify(currentTrip),
      });
    }
    messages.push(...history.map((m) => ({ role: m.role, content: m.content }) as ChatParam));

    let presented: Itinerary | null = null;
    let usedPlanningTool = false;

    for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
      const stream = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools: TOOL_SCHEMAS,
        stream: true,
      });

      let content = "";
      const toolCalls: Record<number, { id: string; name: string; args: string }> = {};

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.content) {
          content += delta.content;
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
      }

      const calls = Object.values(toolCalls);

      if (calls.length > 0) {
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
          if (c.name === "present_itinerary" && result && typeof result === "object" && (result as any).itinerary) {
            presented = (result as any).itinerary as Itinerary;
          }
          messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result) });
        }
        continue;
      }

      // No tool calls → the streamed content was the final answer. If the agent
      // clearly planned a trip but forgot present_itinerary, force one so the
      // notebook always populates.
      if (!presented && usedPlanningTool) {
        messages.push({ role: "assistant", content });
        presented = await this.forcePresent(client, messages);
      }
      if (presented) yield { type: "itinerary", data: presented };
      yield { type: "done" };
      return;
    }

    yield { type: "error", message: "Agent exceeded maximum execution depth." };
    yield { type: "done" };
  }

  private async forcePresent(client: OpenAI, messages: ChatParam[]): Promise<Itinerary | null> {
    try {
      const res = await client.chat.completions.create({
        model: MODEL,
        messages: [
          ...messages,
          {
            role: "user",
            content:
              "Now present the itinerary you just described by calling present_itinerary " +
              "with the structured day-by-day data. Do not write anything else.",
          },
        ],
        tools: TOOL_SCHEMAS,
        tool_choice: { type: "function", function: { name: "present_itinerary" } },
      });
      const call = res.choices[0]?.message?.tool_calls?.[0];
      if (!call) return null;
      let parsed: Record<string, any> = {};
      try {
        parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        return null;
      }
      const result = await executeTool("present_itinerary", parsed);
      if (result && typeof result === "object" && (result as any).itinerary) {
        return (result as any).itinerary as Itinerary;
      }
      return null;
    } catch {
      return null;
    }
  }
}

export const chatService = new ChatService();
