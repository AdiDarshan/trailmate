// Chat business logic — the bounded tool-calling agent loop. Streams the final
// answer's tokens and, if a trip was saved, the resulting tripId. Yields
// AgentEvent objects; the controller serialises them as NDJSON.

import OpenAI from "openai";
import { buildSystemPrompt } from "../../agent/prompt";
import { TOOL_SCHEMAS, executeTool } from "../../agent/tools";
import type { ChatMessage, Day, Itinerary, Place, Trail } from "../../shared/types";

const MODEL = "gpt-4o";
const MAX_ITERATIONS = 10;

// A plan is "concrete" — and worth switching the UI to the notebook — only when it
// has at least one day with an actual trail. Conversational answers, clarifying
// questions, and empty skeletons stay in the chat view instead of flipping pages.
function isConcreteItinerary(it: Itinerary | null): boolean {
  return !!it && Array.isArray(it.days) && it.days.some((d) => !!d?.trail?.name);
}

const sameName = (a?: string, b?: string) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// Fill fields the model dropped when re-presenting an UNCHANGED item. LLMs routinely
// omit long "boring" fields (tiuli_url, waze, maps) on regeneration; if the item's
// identifying name is unchanged, restore whatever the new version is missing.
function backfillTrail(oldT?: Trail | null, newT?: Trail | null): Trail | null | undefined {
  if (!newT || !oldT || !sameName(oldT.name, newT.name)) return newT;
  const keys: (keyof Trail)[] = [
    "distance_km", "duration", "difficulty", "start_maps", "waze", "tiuli_url", "description",
  ];
  const merged: Trail = { ...newT };
  for (const k of keys) if (merged[k] == null || merged[k] === "") (merged[k] as any) = oldT[k];
  return merged;
}

function backfillPlace(oldP?: Place | null, newP?: Place | null): Place | null | undefined {
  if (!newP || !oldP || !sameName(oldP.name, newP.name)) return newP;
  return { ...newP, maps: newP.maps || oldP.maps, address: newP.address || oldP.address };
}

// On edit, merge the model's regenerated itinerary onto the saved one so unchanged
// trails/places keep their links. Matches days by day_number; only fills missing
// fields, so a genuine change (new trail, new restaurant) is never overwritten.
function mergeEditedItinerary(oldIt: Itinerary, newIt: Itinerary): Itinerary {
  if (!oldIt.days?.length || !newIt.days?.length) return newIt;
  const oldByNum = new Map<number, Day>(oldIt.days.map((d) => [d.day_number, d]));
  const days = newIt.days.map((nd) => {
    const od = oldByNum.get(nd.day_number);
    if (!od) return nd;
    return {
      ...nd,
      trail: backfillTrail(od.trail, nd.trail),
      lunch: backfillPlace(od.lunch, nd.lunch),
      dinner: backfillPlace(od.dinner, nd.dinner),
      hotel: backfillPlace(od.hotel, nd.hotel),
    };
  });
  return { ...newIt, days };
}

export type AgentEvent =
  | { type: "text"; v: string }
  | { type: "step"; key: string; label: string } // a tool the agent ran → live checklist row
  | { type: "itinerary"; data: Itinerary }
  | { type: "error"; message: string }
  | { type: "done" };

// Friendly labels for the inline "working" checklist. Keyed so repeated calls of
// the same kind (e.g. two trail searches for a 2-day trip) show as one row.
const STEP_LABELS: Record<string, { key: string; label: string }> = {
  search_tiuli: { key: "trail", label: "Finding a trail" },
  search_trails: { key: "trail", label: "Finding a trail" },
  search_places: { key: "places", label: "Picking food & a place to sleep" },
  get_weather: { key: "weather", label: "Checking the weather" },
  present_itinerary: { key: "itinerary", label: "Putting your itinerary together" },
};

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
    let usedTrailSearch = false; // once true, the agent is building — suppress chat prose
    const emittedSteps = new Set<string>();

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
          // Once the agent is building a trip, its text is the plan being narrated —
          // we don't want that in chat (it belongs in the notebook). Keep it in
          // `content` for context, but don't stream it to the UI.
          if (!usedTrailSearch) yield { type: "text", v: delta.content };
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
          if (c.name === "search_tiuli" || c.name === "search_trails") usedTrailSearch = true;
          // Live checklist: surface each kind of tool once, before it runs, so the
          // UI shows "Finding a trail…", "Checking the weather…" as work happens.
          const step = STEP_LABELS[c.name];
          if (step && !emittedSteps.has(step.key)) {
            emittedSteps.add(step.key);
            yield { type: "step", key: step.key, label: step.label };
          }
          const result = await executeTool(c.name, parsed);
          if (c.name === "present_itinerary" && result && typeof result === "object" && (result as any).itinerary) {
            const fresh = (result as any).itinerary as Itinerary;
            // Editing an existing trip → restore links the model dropped for
            // unchanged trails/places. Fresh trips (no currentTrip) pass through.
            presented = currentTrip ? mergeEditedItinerary(currentTrip, fresh) : fresh;
          }
          messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result) });
        }

        // Concrete plan in hand → open the notebook and STOP. Never give the model
        // another turn to re-type the itinerary as chat prose.
        if (isConcreteItinerary(presented)) {
          yield { type: "itinerary", data: presented as Itinerary };
          yield { type: "done" };
          return;
        }
        continue;
      }

      // No tool calls → the streamed text was the final answer.
      if (isConcreteItinerary(presented)) {
        yield { type: "itinerary", data: presented as Itinerary };
      } else if (usedTrailSearch) {
        // The agent planned (searched trails) but didn't hand back a structured
        // itinerary — it wrote the plan as prose (which we suppressed). Convert that
        // into a real present_itinerary so the notebook opens instead of nothing.
        messages.push({ role: "assistant", content });
        let forced = await this.forcePresent(client, messages);
        if (forced && currentTrip) forced = mergeEditedItinerary(currentTrip, forced);
        if (isConcreteItinerary(forced)) {
          yield { type: "itinerary", data: forced as Itinerary };
        } else if (content.trim()) {
          // Couldn't structure it — don't swallow the answer; show the text.
          yield { type: "text", v: content };
        }
      }
      yield { type: "done" };
      return;
    }

    yield { type: "error", message: "Agent exceeded maximum execution depth." };
    yield { type: "done" };
  }

  // Force a structured present_itinerary out of the plan the model just described
  // in prose. Used as a safety net when the agent planned but didn't return a
  // concrete itinerary on its own. Returns null if it still can't produce one.
  private async forcePresent(client: OpenAI, messages: ChatParam[]): Promise<Itinerary | null> {
    try {
      const res = await client.chat.completions.create({
        model: MODEL,
        messages: [
          ...messages,
          {
            role: "user",
            content:
              "Output ONLY the present_itinerary tool call for the trip you just planned — " +
              "full structured day-by-day data (each day must include a trail with a name, " +
              "plus meals, a place to sleep, and the weather). Write no other text.",
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
