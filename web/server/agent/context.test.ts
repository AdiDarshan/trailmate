// Port of the Python prototype's tests/test_context_manager.py.
// No network calls: tier 3 injects a stub summarizeFn.

import { describe, expect, it } from "vitest";
import { ContextManager, keepLastNGroups, type ContextMessage } from "./context";

describe("ContextManager", () => {
  it("starts with zeroed metrics", () => {
    const cm = new ContextManager({ maxContextTokens: 1000 });
    expect(cm.metrics).toEqual({ input_tokens: 0, output_tokens: 0, total_tokens: 0 });
    expect(cm.maxContextTokens).toBe(1000);
  });

  it("trackBurn accumulates metrics", () => {
    const cm = new ContextManager({ maxContextTokens: 50 });
    cm.trackBurn({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    cm.trackBurn({ prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 });
    expect(cm.metrics).toEqual({ input_tokens: 30, output_tokens: 13, total_tokens: 43 });
  });

  it("estimateTokens returns a positive integer for real messages", () => {
    const cm = new ContextManager({ maxContextTokens: 1000 });
    const history: ContextMessage[] = [
      { role: "system", content: "You are TrailMate." },
      { role: "user", content: "Hello" },
    ];
    const n = cm.estimateTokens(history);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it("returns history unchanged when under budget", async () => {
    const cm = new ContextManager({ maxContextTokens: 10_000 });
    const history: ContextMessage[] = [
      { role: "system", content: "You are TrailMate." },
      { role: "user", content: "Plan a trip." },
      { role: "assistant", content: "Sure, where to?" },
    ];
    const result = await cm.enforceCompaction(history);
    expect(result).toEqual(history);
  });

  it("step 1 evicts tool payloads when over budget", async () => {
    // The tool result is the only large message, so tier 1 alone should
    // bring the total under the limit.
    const cm = new ContextManager({ maxContextTokens: 120 });
    const bigPayload = JSON.stringify({ status: "success", blob: "x".repeat(4000) });
    const history: ContextMessage[] = [
      { role: "system", content: "You are TrailMate." },
      { role: "user", content: "Make a PDF." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "export_pdf", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call_1", content: bigPayload },
      { role: "assistant", content: "Done." },
    ];

    const result = await cm.enforceCompaction(history);

    const toolMsgs = result.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].content).toBe("[tool result evicted]");
    expect(toolMsgs[0].tool_call_id).toBe("call_1");
    expect(result).toHaveLength(history.length);
    // Return-view only: the input history must not be mutated.
    expect(history[3].content).toBe(bigPayload);
  });

  it("falls through to step 2 (last 4 groups) when step 1 is insufficient", async () => {
    // Plain-text turns only — no tool messages, so tier 1 is a no-op and
    // tier 2 must kick in. Budget sized so tier 2 alone fits.
    const cm = new ContextManager({ maxContextTokens: 200 });
    const history: ContextMessage[] = [{ role: "system", content: "S" }];
    for (let i = 0; i < 8; i++) {
      history.push({ role: "user", content: `u${i} ` + "x".repeat(50) });
      history.push({ role: "assistant", content: `a${i} ` + "y".repeat(50) });
    }

    const result = await cm.enforceCompaction(history);

    expect(result[0].role).toBe("system");
    // Each plain message is its own group → exactly 4 kept.
    expect(result.slice(1)).toHaveLength(4);
  });

  it("step 3 summarizes the discarded middle when steps 1 and 2 are insufficient", async () => {
    const cm = new ContextManager({
      maxContextTokens: 20,
      summarizeFn: async () => "STUBBED SUMMARY",
    });
    const history: ContextMessage[] = [{ role: "system", content: "S" }];
    for (let i = 0; i < 10; i++) {
      // Each message alone exceeds the budget, so even the trimmed tail is
      // over → tier 3 fires.
      history.push({ role: "user", content: "u" + "x".repeat(200) });
      history.push({ role: "assistant", content: "a" + "y".repeat(200) });
    }

    const result = await cm.enforceCompaction(history);

    // Layout: [system seed, summary message, ...last 4 groups]
    expect(result[0].role).toBe("system");
    expect(result[1].role).toBe("system");
    expect(String(result[1].content)).toContain("STUBBED SUMMARY");
    expect(result.slice(2)).toHaveLength(4);
  });

  it("falls back to step 2 when no summarizeFn is injected", async () => {
    const cm = new ContextManager({ maxContextTokens: 20 });
    const history: ContextMessage[] = [{ role: "system", content: "S" }];
    for (let i = 0; i < 10; i++) {
      history.push({ role: "user", content: "u" + "x".repeat(200) });
    }

    const result = await cm.enforceCompaction(history);

    expect(result[0].role).toBe("system");
    expect(result.slice(1)).toHaveLength(4);
    expect(result.every((m) => !String(m.content).startsWith("Previous context summary"))).toBe(true);
  });
});

describe("keepLastNGroups", () => {
  it("keeps a tool call and its result together (never split)", () => {
    const messages: ContextMessage[] = [
      { role: "user", content: "u1" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1" }] },
      { role: "tool", tool_call_id: "c1", content: "r1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ];

    // Last 2 groups are ["a1"] and ["u2"] — the assistant+tool group must
    // not be split down the middle.
    const result = keepLastNGroups(messages, 2);
    expect(result.map((m) => m.content)).toEqual(["a1", "u2"]);
  });

  it("treats an assistant tool_call plus its results as a single unit", () => {
    const messages: ContextMessage[] = [
      { role: "user", content: "u1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1" }] },
      { role: "tool", tool_call_id: "c1", content: "r1" },
    ];

    // Last 2 groups = [u2] and [assistant tool_call + tool result].
    const result = keepLastNGroups(messages, 2);
    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(result[result.length - 1].tool_call_id).toBe("c1");
  });
});
