// Chat business logic — the bounded tool-calling agent loop. Streams the final
// answer's tokens and, if a trip was presented, the resulting itinerary. Yields
// AgentEvent objects; the controller serialises them as NDJSON.

import OpenAI from "openai";
import { ContextManager, type ContextMessage } from "../../agent/context";
import { buildSystemPrompt } from "../../agent/prompt";
import { TOOL_SCHEMAS, executeTool } from "../../agent/tools";
import { createLogger, errInfo } from "../../shared/logger";
import type { ChatMessage, Itinerary, SavedTrailRefs } from "../../shared/types";
import {
  STEP_LABELS,
  collectTrailCandidates,
  ensureStartDate,
  filterSavedTrails,
  findDuplicateTrails,
  findUncatalogedTrails,
  isConcreteItinerary,
  mergeEditedItinerary,
  newTrailCandidates,
} from "./chat.helpers";
import { addDaysISO, israelToday } from "../reminder/reminder.helpers";

const MODEL = "gpt-4o";
const SUMMARY_MODEL = "gpt-4o-mini";
const MAX_ITERATIONS = 10;
// Well under gpt-4o's 128k — keeps latency inside the serverless budget and
// stops old tool payloads (fat search results) from riding along forever.
const MAX_CONTEXT_TOKENS = 32_000;

const log = createLogger("chat.service");

export type AgentEvent =
  | { type: "text"; v: string }
  | { type: "step"; key: string; label: string } // a tool the agent ran → live checklist row
  | { type: "itinerary"; data: Itinerary }
  | { type: "error"; message: string }
  | { type: "done" };

type ChatParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Prompt-note cap: a power user's saved-trail list must not crowd the context.
// The hard filter below still applies to ALL saved trails regardless.
const MAX_PROMPT_TRAIL_NAMES = 50;

class ChatService {
  async *run(
    history: ChatMessage[],
    currentTrip: Itinerary | null = null,
    savedTrails: SavedTrailRefs | null = null,
    preferences: string | null = null,
  ): AsyncGenerator<AgentEvent> {
    const turnStart = Date.now();
    log.info("turn_start", {
      historyLen: history.length,
      hasTrip: !!currentTrip,
      savedTrailCount: savedTrails?.names.length ?? 0,
    });

    const client = new OpenAI();
    // Stateless per request: the client posts full history, we compact a
    // *view* of it before every model call. Summarization (tier 3) is rare
    // and cheap, so it runs on the small model.
    const context = new ContextManager({
      maxContextTokens: MAX_CONTEXT_TOKENS,
      summarizeFn: async (prompt) => {
        const res = await log.timed("openai_summarize", { model: SUMMARY_MODEL }, () =>
          client.chat.completions.create({
            model: SUMMARY_MODEL,
            messages: [{ role: "user", content: prompt }],
          }),
        );
        return res.choices[0]?.message?.content?.trim() ?? "";
      },
    });
    const messages: ChatParam[] = [
      { role: "system", content: buildSystemPrompt() },
    ];
    // Standing preferences the user set in the app — apply to every choice,
    // not just when the user repeats them in chat.
    if (preferences?.trim()) {
      messages.push({
        role: "system",
        content:
          "STANDING USER PREFERENCES (set once in the app — apply them to every " +
          "trail, food, and hotel search and choice in this conversation; the user " +
          "should not have to repeat them):\n" +
          preferences.trim(),
      });
    }
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
    // Personalization: name the trails the user already saved so the model
    // understands WHY they're absent from search results (they're hard-filtered
    // below) and can still discuss one when the user explicitly asks for it.
    if (savedTrails && savedTrails.names.length > 0) {
      const shown = savedTrails.names.slice(0, MAX_PROMPT_TRAIL_NAMES);
      const more = savedTrails.names.length - shown.length;
      messages.push({
        role: "system",
        content:
          "The user has already saved trips that include these trails: " +
          shown.join(", ") +
          (more > 0 ? ` (and ${more} more)` : "") +
          ". They are excluded from trail search results — do not recommend them " +
          "again unless the user explicitly asks to repeat a specific trail.",
      });
    }
    messages.push(...history.map((m) => ({ role: m.role, content: m.content }) as ChatParam));

    let presented: Itinerary | null = null;
    let usedTrailSearch = false; // once true, the agent is building — suppress chat prose
    const emittedSteps = new Set<string>();

    // Catalog-only gate: presentable trails are ones search_tiuli returns this
    // turn, plus the trip being edited and saved trails (the user may explicitly
    // ask to repeat one). Everything else is rejected in the loop below.
    const candidates = newTrailCandidates();
    if (currentTrip) collectTrailCandidates(currentTrip.days?.map((d) => d.trail), candidates);
    if (savedTrails) {
      for (const n of savedTrails.names) candidates.names.add(n.trim().toLowerCase());
      for (const u of savedTrails.urls) candidates.urls.add(u);
    }

    // Search exclusion: saved trails PLUS whatever is already on the trip being
    // edited — "add a day" must be offered something NEW, not day 1's trail again.
    const searchExcludes: SavedTrailRefs = {
      names: [...(savedTrails?.names ?? [])],
      urls: [...(savedTrails?.urls ?? [])],
    };
    for (const d of currentTrip?.days ?? []) {
      if (d?.trail?.name) searchExcludes.names.push(d.trail.name);
      if (d?.trail?.tiuli_url) searchExcludes.urls.push(d.trail.tiuli_url);
    }
    const hasSearchExcludes = searchExcludes.names.length > 0 || searchExcludes.urls.length > 0;

    for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
      const compacted = await context.enforceCompaction(messages as ContextMessage[]);
      const stream = await log.timed("openai_chat", { model: MODEL, iter, msgs: compacted.length }, () =>
        client.chat.completions.create({
          model: MODEL,
          messages: compacted as ChatParam[],
          tools: TOOL_SCHEMAS,
          stream: true,
          stream_options: { include_usage: true },
        }),
      );

      let content = "";
      const toolCalls: Record<number, { id: string; name: string; args: string }> = {};

      for await (const chunk of stream) {
        if (chunk.usage) context.trackBurn(chunk.usage);
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
          } catch (e) {
            // Malformed streamed JSON — run the tool with {} so its schema
            // validation produces a structured error the model can react to.
            log.warn("tool_args_unparseable", { tool: c.name, argsLen: c.args.length, ...errInfo(e) });
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
          // executeTool never throws — failures come back as {status:"error"}
          // observations for the model. timed() here records tool latency.
          let result = await log.timed("tool_call", { tool: c.name, iter }, () =>
            executeTool(c.name, parsed),
          );
          // Trails the user already has — saved trips or the trip on screen —
          // never reach the model as search candidates.
          if (hasSearchExcludes && (c.name === "search_tiuli" || c.name === "search_trails")) {
            const { filtered, removed } = filterSavedTrails(result, searchExcludes);
            if (removed > 0) {
              log.info("saved_trails_filtered", { tool: c.name, iter, removed });
              result = filtered;
            }
          }
          // Catalog results become the presentable set. search_trails (OSM) is
          // deliberately NOT collected — its results are geographic context only.
          if (c.name === "search_tiuli") {
            collectTrailCandidates((result as { trails?: unknown[] } | null)?.trails, candidates);
          }
          if (c.name === "present_itinerary" && result && typeof result === "object" && (result as any).itinerary) {
            const fresh = (result as any).itinerary as Itinerary;
            const unknown = findUncatalogedTrails(fresh, candidates);
            const dupes = findDuplicateTrails(fresh);
            if (dupes.length > 0) {
              // Same trail on two days — almost always a lazy "add a day" edit.
              log.warn("duplicate_trails_rejected", { iter, trails: dupes });
              result = {
                status: "error",
                message:
                  `Rejected: these trails appear on more than one day: ${dupes.join(", ")}. ` +
                  "Every day needs a DIFFERENT trail. Keep the existing days exactly as they are " +
                  "and search_tiuli for a new trail for the added/changed day (trails already on " +
                  "this trip are excluded from search results).",
              };
            } else if (unknown.length > 0) {
              // Hard gate: a trail the catalog never returned must not reach the
              // user. The error is the model's observation — it re-searches and retries.
              log.warn("uncataloged_trails_rejected", { iter, trails: unknown });
              result = {
                status: "error",
                message:
                  `Rejected: these trails did not come from this conversation's search_tiuli results: ${unknown.join(", ")}. ` +
                  "Every itinerary trail must be copied exactly (name and tiuli_url) from a search_tiuli result — " +
                  "never from memory and never from search_trails. Search the catalog, then call " +
                  "present_itinerary again using only returned trails.",
              };
            } else {
              // Editing an existing trip → restore links the model dropped for
              // unchanged trails/places. Fresh trips (no currentTrip) pass through.
              const merged = currentTrip ? mergeEditedItinerary(currentTrip, fresh) : fresh;
              presented = ensureStartDate(merged, addDaysISO(israelToday(), 1));
            }
          }
          messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result) });
        }

        // Concrete plan in hand → open the notebook and STOP. Never give the model
        // another turn to re-type the itinerary as chat prose.
        if (isConcreteItinerary(presented)) {
          log.info("turn_end", { outcome: "itinerary", iterations: iter, ms: Date.now() - turnStart });
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
        log.warn("force_present_needed", { iter });
        messages.push({ role: "assistant", content });
        const forceView = (await context.enforceCompaction(messages as ContextMessage[])) as ChatParam[];
        let forced = await this.forcePresent(client, forceView);
        if (forced && currentTrip) forced = mergeEditedItinerary(currentTrip, forced);
        if (forced) forced = ensureStartDate(forced, addDaysISO(israelToday(), 1));
        if (forced) {
          // The forced call bypasses the loop's rejection path — apply the same
          // catalog + no-duplicate gates here; a violation falls through to the
          // text fallback.
          const unknown = findUncatalogedTrails(forced, candidates);
          const dupes = findDuplicateTrails(forced);
          if (unknown.length > 0 || dupes.length > 0) {
            log.warn("forced_itinerary_rejected", { uncataloged: unknown, duplicates: dupes });
            forced = null;
          }
        }
        if (isConcreteItinerary(forced)) {
          yield { type: "itinerary", data: forced as Itinerary };
        } else if (content.trim()) {
          // Couldn't structure it — don't swallow the answer; show the text.
          yield { type: "text", v: content };
        }
      }
      log.info("turn_end", {
        outcome: usedTrailSearch ? "planned" : "answered",
        iterations: iter,
        ms: Date.now() - turnStart,
      });
      yield { type: "done" };
      return;
    }

    log.error("turn_end", { outcome: "max_iterations", iterations: MAX_ITERATIONS, ms: Date.now() - turnStart });
    yield { type: "error", message: "Agent exceeded maximum execution depth." };
    yield { type: "done" };
  }

  // Force a structured present_itinerary out of the plan the model just described
  // in prose. Used as a safety net when the agent planned but didn't return a
  // concrete itinerary on its own. Returns null if it still can't produce one.
  private async forcePresent(client: OpenAI, messages: ChatParam[]): Promise<Itinerary | null> {
    try {
      const res = await log.timed("openai_force_present", { model: MODEL }, () =>
        client.chat.completions.create({
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
        }),
      );
      const call = res.choices[0]?.message?.tool_calls?.[0];
      if (!call) return null;
      let parsed: Record<string, any> = {};
      try {
        parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch (e) {
        log.warn("force_present_unparseable", errInfo(e));
        return null;
      }
      const result = await executeTool("present_itinerary", parsed);
      if (result && typeof result === "object" && (result as any).itinerary) {
        return (result as any).itinerary as Itinerary;
      }
      return null;
    } catch (e) {
      // Best-effort safety net: the turn still ends with the prose answer.
      log.error("force_present_failed", errInfo(e));
      return null;
    }
  }
}

export const chatService = new ChatService();
