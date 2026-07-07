// Token-budgeted context manager for the agent loop — TypeScript port of the
// Python prototype's `trailmate.ai.context.ContextManager`.
//
// Tracks token spend across iterations and applies a tiered compaction
// strategy when the conversation crosses a configured budget:
//
//   1. Evict raw tool payloads (replace `tool` message content with a short
//      placeholder; preserves message structure so tool_call/tool_response
//      pairs still validate).
//   2. Keep only the last N *groups* — a group is a non-tool message OR an
//      assistant `tool_calls` message plus all of its `tool` results, so a
//      tool round-trip is never split (orphan tool messages are rejected by
//      the OpenAI API).
//   3. Summarize everything between the system seed and the kept tail into
//      one synthetic system message, via the injected `summarizeFn`.
//
// Compaction is *return-view only* — the caller's message array is never
// mutated; each loop iteration recomputes the compacted view.

import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";
import { createLogger } from "../shared/logger";

const log = createLogger("agent.context");

// Any chat-completion message. Structural on purpose so the module doesn't
// depend on the OpenAI SDK's param types (mirrors the Python dict approach).
export interface ContextMessage {
  role: string;
  content?: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
  [key: string]: unknown;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// gpt-4o family uses the o200k_base encoding. One encoder per process — the
// rank table is large, so never construct this per request.
const encoding = new Tiktoken(o200k_base);

const KEEP_LAST_GROUPS = 4;

export class ContextManager {
  readonly maxContextTokens: number;
  readonly metrics = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  private summarizeFn?: (prompt: string) => Promise<string>;

  constructor(opts: {
    maxContextTokens: number;
    summarizeFn?: (prompt: string) => Promise<string>;
  }) {
    this.maxContextTokens = opts.maxContextTokens;
    this.summarizeFn = opts.summarizeFn;
  }

  /** Accumulate an API response's usage. Logs only past 60% of budget. */
  trackBurn(usage: TokenUsage): void {
    this.metrics.input_tokens += usage.prompt_tokens;
    this.metrics.output_tokens += usage.completion_tokens;
    this.metrics.total_tokens += usage.total_tokens;

    const pct = this.metrics.input_tokens / this.maxContextTokens;
    if (pct >= 0.6) {
      log.info("token_budget", {
        pct: Math.round(pct * 100),
        inputTokens: this.metrics.input_tokens,
        budget: this.maxContextTokens,
        outputTokens: this.metrics.output_tokens,
      });
    }
  }

  /** Return a (possibly compacted) view of `history` under the budget. */
  async enforceCompaction(history: ContextMessage[]): Promise<ContextMessage[]> {
    const beforeMsgs = history.length;
    const beforeTokens = this.estimateTokens(history);

    if (beforeTokens <= this.maxContextTokens) return history;

    // ---- Step 1: replace tool result payloads with a placeholder. ----
    const step1 = history.map((msg) =>
      msg.role === "tool" ? { ...msg, content: "[tool result evicted]" } : msg,
    );
    if (this.estimateTokens(step1) <= this.maxContextTokens) {
      log.info("compaction", {
        tier: 1, beforeMsgs, beforeTokens, afterMsgs: step1.length, afterTokens: this.estimateTokens(step1),
      });
      return step1;
    }

    // ---- Step 2: keep last N groups (atomic tool round-trips). ----
    let systemMsg: ContextMessage | null = null;
    let bodyStart = 0;
    if (step1.length > 0 && step1[0].role === "system") {
      systemMsg = step1[0];
      bodyStart = 1;
    }
    const body = step1.slice(bodyStart);
    const lastGroupsFlat = keepLastNGroups(body, KEEP_LAST_GROUPS);
    const step2 = (systemMsg ? [systemMsg] : []).concat(lastGroupsFlat);
    if (this.estimateTokens(step2) <= this.maxContextTokens) {
      log.info("compaction", {
        tier: 2, beforeMsgs, beforeTokens, afterMsgs: step2.length, afterTokens: this.estimateTokens(step2),
      });
      return step2;
    }

    // ---- Step 3: summarize the discarded middle into one message. ----
    const middle = body.slice(0, body.length - lastGroupsFlat.length);
    if (middle.length === 0 || !this.summarizeFn) {
      // Nothing to summarize (or no LLM injected) — step 2 is the final fallback.
      log.info("compaction", {
        tier: 2, final: true, beforeMsgs, beforeTokens, afterMsgs: step2.length, afterTokens: this.estimateTokens(step2),
      });
      return step2;
    }

    const summary = await this.summarize(middle);
    const summaryMsg: ContextMessage = {
      role: "system",
      content: `Previous context summary: ${summary}`,
    };
    const result = (systemMsg ? [systemMsg] : [])
      .concat([summaryMsg])
      .concat(lastGroupsFlat);
    log.info("compaction", {
      tier: 3, beforeMsgs, beforeTokens, afterMsgs: result.length, afterTokens: this.estimateTokens(result),
    });
    return result;
  }

  /** Compress `history` into a short summary via the injected callable. */
  private async summarize(history: ContextMessage[]): Promise<string> {
    const renderedLines = history.map((msg) => {
      const role = msg.role ?? "?";
      const content = typeof msg.content === "string" ? msg.content : "";
      if (msg.tool_calls) {
        return `${role}: [tool_calls=${JSON.stringify(msg.tool_calls)}] ${content}`;
      }
      return `${role}: ${content}`;
    });

    const prompt =
      "Summarize the following conversation history concisely, preserving " +
      "key facts, decisions, and tool results:\n" +
      renderedLines.join("\n");
    return this.summarizeFn!(prompt);
  }

  /** Sum tiktoken-measured token counts across every message. */
  estimateTokens(context: ContextMessage[]): number {
    let total = 0;
    for (const msg of context) {
      let serialized: string;
      try {
        serialized = JSON.stringify(msg) ?? String(msg);
      } catch {
        serialized = String(msg);
      }
      total += encoding.encode(serialized).length;
    }
    return total;
  }
}

/**
 * Return the last `n` conversation groups as a flat message list. A "group"
 * is a single non-tool message, or an assistant `tool_calls` message plus
 * every immediately following `tool` result — kept atomic so eviction never
 * produces orphan tool messages.
 */
export function keepLastNGroups(messages: ContextMessage[], n: number): ContextMessage[] {
  const groups: ContextMessage[][] = [];
  let current: ContextMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "tool") {
      if (current.length === 0) current = [msg];
      else current.push(msg);
    } else {
      if (current.length > 0) groups.push(current);
      current = [msg];
    }
  }
  if (current.length > 0) groups.push(current);

  return groups.slice(-n).flat();
}
