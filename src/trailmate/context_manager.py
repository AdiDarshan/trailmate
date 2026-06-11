"""Token-budgeted context window manager for AgentHarness.

Tracks token spend across iterations and applies a tiered compaction
strategy when the conversation crosses a configured budget. Exposed
via three public methods:

- `track_burn(usage)`     — accumulate token counters from an API response
- `enforce_compaction(...)` — return a compacted view of the history
                              (does NOT mutate the input)
- (helpers `_summarize`, `_estimate_tokens` are private)

Design notes (see grill-me session for full reasoning):
- Compaction is *return-view only* — `self.chat_history` on the harness
  stays intact. Each `run()` iteration recomputes compaction. This costs
  a re-summarization when step 3 fires repeatedly; mitigated by the fact
  that step 3 is rare and bounded.
- Token estimation uses `tiktoken` (already installed transitively via
  `openai`) for accurate counts on JSON-heavy tool messages, where the
  classic `chars/4` heuristic systematically under-counts.
- "Keep last N messages" is implemented as "keep last N *groups*" where
  a group is a non-tool message OR an assistant `tool_calls` message
  plus all its matching `tool` results. This guarantees no orphan tool
  messages, which the OpenAI API rejects.
"""

from __future__ import annotations

import json
from typing import Any

import tiktoken
from openai import OpenAI


class ContextManager:
    """Owns token accounting + compaction for a chat-completion loop."""

    def __init__(self, max_context_tokens: int) -> None:
        self.max_context_tokens = max_context_tokens
        self.metrics = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

        # Lazily constructed; only populated if step 3 (summarize) fires.
        # Keeping it lazy means tests that build a ContextManager don't
        # need OPENAI_API_KEY set in env.
        self._summary_client: OpenAI | None = None

        # tiktoken encoding for token counting. We hard-code the gpt-4o
        # tokenizer family because the rest of the project targets gpt-4o;
        # if the harness model ever diverges we can parameterize this.
        try:
            self._encoding = tiktoken.encoding_for_model("gpt-4o")
        except KeyError:
            # Fallback for environments where tiktoken's registry doesn't
            # know the model name yet.
            self._encoding = tiktoken.get_encoding("cl100k_base")

    def track_burn(self, usage: Any) -> None:
        """Add this API response's usage to running totals and print a line.

        The OpenAI SDK exposes `prompt_tokens`, `completion_tokens`, and
        `total_tokens` on the `usage` object of every response. We accept
        `Any` because the SDK uses pydantic models; duck-typing on the
        attribute names keeps us compatible across SDK versions.
        """
        self.metrics["input_tokens"] += usage.prompt_tokens
        self.metrics["output_tokens"] += usage.completion_tokens
        self.metrics["total_tokens"] += usage.total_tokens
        # NOTE: this is the only `print()` in library code in the project.
        # Per `PROJECT SKILL.md`, library logging belongs in `logging`;
        # we follow the spec literally for now and will revisit.
        print(
            "Token burn — in: "
            f"{self.metrics['input_tokens']} | "
            f"out: {self.metrics['output_tokens']} | "
            f"total: {self.metrics['total_tokens']}"
        )

    def enforce_compaction(self, history: list, tool_use: Any) -> list:
        """Return a (possibly compacted) view of `history` under the budget.

        Does NOT mutate `history`. Applies the three-step strategy in
        order, returning early as soon as the result fits the budget:

        1. Evict raw tool payloads (replace `tool` message content with a
           short placeholder; preserves message structure so tool_call/
           tool_response pairs still validate).
        2. Keep only the last 4 *groups* (a group is one non-tool message,
           or an assistant tool_call + all its matching tool results).
        3. Summarize everything between the system seed and the kept tail
           into a single synthetic system message.

        `tool_use` is currently unread by the body but kept on the
        signature as a deliberate forward hook for future tool-aware
        compaction (e.g. "always preserve the most recent result of each
        unique tool"). See grill-me Q2.
        """
        del tool_use  # forward-compat hook; intentionally unused for now

        # TEMPORARY-E2E: capture "before" stats for the debug print below.
        before_msgs = len(history)
        before_tokens = self._estimate_tokens(history)

        # Fast path: already under budget, return the input unchanged.
        if before_tokens <= self.max_context_tokens:
            return history

        # ---- Step 1: replace tool result payloads with a placeholder. ----
        # We rebuild a new list rather than mutating `history`. Tool
        # messages keep their `tool_call_id` so the call/response pairing
        # is preserved — only `content` shrinks.
        step1: list[dict] = []
        for msg in history:
            if msg.get("role") == "tool":
                step1.append({**msg, "content": "[tool result evicted]"})
            else:
                step1.append(msg)
        if self._estimate_tokens(step1) <= self.max_context_tokens:
            # TEMPORARY-E2E
            print(
                f"[compaction step 1] {before_msgs} msgs / {before_tokens} tok"
                f"  →  {len(step1)} msgs / {self._estimate_tokens(step1)} tok"
            )
            return step1

        # ---- Step 2: keep last 4 groups (atomic tool round-trips). ----
        # System message at index 0 is preserved separately so it isn't
        # accidentally counted as one of the "last 4 groups".
        system_msg: dict | None = None
        body_start = 0
        if step1 and step1[0].get("role") == "system":
            system_msg = step1[0]
            body_start = 1
        body = step1[body_start:]
        last_groups_flat = _keep_last_n_groups(body, n=4)
        step2 = ([system_msg] if system_msg else []) + last_groups_flat
        if self._estimate_tokens(step2) <= self.max_context_tokens:
            # TEMPORARY-E2E
            print(
                f"[compaction step 2] {before_msgs} msgs / {before_tokens} tok"
                f"  →  {len(step2)} msgs / {self._estimate_tokens(step2)} tok"
            )
            return step2

        # ---- Step 3: summarize the discarded middle into one message. ----
        # The "middle" is whatever step 2 evicted: everything between the
        # system seed and the kept tail. If the middle is empty (tail is
        # already huge) there's nothing to summarize, so return step2.
        kept_tail_len = len(last_groups_flat)
        middle = body[: len(body) - kept_tail_len]
        if not middle:
            # TEMPORARY-E2E
            print(
                f"[compaction step 2 only — nothing to summarize] "
                f"{before_msgs} msgs / {before_tokens} tok"
                f"  →  {len(step2)} msgs / {self._estimate_tokens(step2)} tok"
            )
            return step2

        # TODO: cache summaries by hash(middle) to avoid re-summarizing
        # the same range on every iteration of the agent loop.
        summary = self._summarize(middle)
        summary_msg = {
            "role": "system",
            "content": f"Previous context summary: {summary}",
        }
        result = ([system_msg] if system_msg else []) + [summary_msg] + last_groups_flat
        # TEMPORARY-E2E
        print(
            f"[compaction step 3 — summarized] {before_msgs} msgs / {before_tokens} tok"
            f"  →  {len(result)} msgs / {self._estimate_tokens(result)} tok"
        )
        return result

    def _summarize(self, history: list) -> str:
        """Use a cheap model to compress `history` into a short summary."""
        if self._summary_client is None:
            self._summary_client = OpenAI()

        # Render messages as plain text. Tool-call dicts are JSON-dumped
        # so the model sees a readable approximation of what happened.
        rendered_lines: list[str] = []
        for msg in history:
            role = msg.get("role", "?")
            content = msg.get("content") or ""
            if msg.get("tool_calls"):
                calls = json.dumps(msg["tool_calls"], default=str)
                rendered_lines.append(f"{role}: [tool_calls={calls}] {content}")
            else:
                rendered_lines.append(f"{role}: {content}")
        history_text = "\n".join(rendered_lines)

        response = self._summary_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Summarize the following conversation history "
                        "concisely, preserving key facts, decisions, and "
                        "tool results:\n" + history_text
                    ),
                }
            ],
        )
        return response.choices[0].message.content or ""

    def _estimate_tokens(self, context: list) -> int:
        """Sum tiktoken-measured token counts across every message.

        We JSON-encode each message before counting so structural chars
        (`{}`, `[]`, `:`, `,`, key names) are accurately tokenized — this
        is exactly where the chars/4 heuristic under-counts by 30-50%.
        """
        total = 0
        for msg in context:
            try:
                serialized = json.dumps(msg, default=str)
            except (TypeError, ValueError):
                serialized = str(msg)
            total += len(self._encoding.encode(serialized))
        return total


def _keep_last_n_groups(messages: list, n: int) -> list:
    """Return the last `n` conversation groups as a flat list of messages.

    A "group" is either:
    - a single non-tool message (user, assistant text, etc.), OR
    - an assistant message with `tool_calls` plus every immediately
      following `tool` message (its results).

    This guarantees we never split a tool-call/tool-result pair across
    the eviction boundary, which would produce orphan tool messages and
    cause the OpenAI API to reject the next request.
    """
    groups: list[list[dict]] = []
    current: list[dict] = []

    for msg in messages:
        role = msg.get("role")
        if role == "tool":
            # Tool result attaches to the current (assistant) group.
            # If we somehow encounter a tool with no preceding group
            # (corrupt input), start a new group anyway — better to keep
            # something than silently drop.
            if not current:
                current = [msg]
            else:
                current.append(msg)
        else:
            # Any non-tool role starts a fresh group.
            if current:
                groups.append(current)
            current = [msg]
    if current:
        groups.append(current)

    kept_groups = groups[-n:]
    return [m for g in kept_groups for m in g]


if __name__ == "__main__":
    # Smoke test: build a synthetic history that's clearly over a tiny
    # budget, run compaction, and print the resulting message count and
    # estimated tokens at each step.
    cm = ContextManager(max_context_tokens=200)

    fake_history: list[dict] = [
        {"role": "system", "content": "You are TrailMate."},
    ]
    # 8 user/assistant turns, each with a chunky tool round-trip.
    for i in range(8):
        fake_history.append({"role": "user", "content": f"Turn {i}: tell me about Lisbon."})
        fake_history.append(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": f"call_{i}",
                        "type": "function",
                        "function": {
                            "name": "export_pdf",
                            "arguments": json.dumps(
                                {"filename": f"lisbon_{i}.pdf", "content": "x" * 200}
                            ),
                        },
                    }
                ],
            }
        )
        fake_history.append(
            {
                "role": "tool",
                "tool_call_id": f"call_{i}",
                "content": json.dumps({"status": "success", "path": f"lisbon_{i}.pdf"}),
            }
        )
        fake_history.append(
            {"role": "assistant", "content": f"Done with turn {i}, here is your PDF."}
        )

    print(
        f"Original history: {len(fake_history)} messages, "
        f"~{cm._estimate_tokens(fake_history)} tokens"
    )
    compacted = cm.enforce_compaction(fake_history, tool_use=None)
    print(
        f"Compacted history: {len(compacted)} messages, "
        f"~{cm._estimate_tokens(compacted)} tokens"
    )
    print("Compacted preview (first 2 + last 2 messages):")
    for msg in compacted[:2] + compacted[-2:]:
        print(f"  - {msg.get('role')}: {str(msg.get('content'))[:80]}")
