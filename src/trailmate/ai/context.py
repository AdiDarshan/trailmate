"""Token-budgeted context window manager for the AI service.

Tracks token spend across iterations and applies a tiered compaction
strategy when the conversation crosses a configured budget. Exposed
via three public methods:

- ``track_burn(usage)``       — accumulate token counters from an API response
- ``enforce_compaction(...)`` — return a compacted view of the history
                                (does NOT mutate the input)
- ``_summarize`` / ``_estimate_tokens`` — private helpers

Design notes:
- Compaction is *return-view only* — ``chat_history`` on the service stays
  intact. Each ``run()`` iteration recomputes compaction.
- Token estimation uses ``tiktoken`` for accurate counts on JSON-heavy
  tool messages.
- "Keep last N messages" is implemented as "keep last N *groups*" where
  a group is a non-tool message OR an assistant ``tool_calls`` message
  plus all its matching ``tool`` results. This guarantees no orphan tool
  messages, which the OpenAI API rejects.
- The summarization callable is injected at construction time so this
  class has no direct dependency on any LLM SDK.
"""

from __future__ import annotations

import json
from typing import Any, Callable

import tiktoken

from trailmate.logging_config import get_logger

logger = get_logger(__name__)


class ContextManager:
    """Owns token accounting + compaction for a chat-completion loop."""

    def __init__(
        self,
        max_context_tokens: int,
        summarize_fn: Callable[[str], str] | None = None,
    ) -> None:
        self.max_context_tokens = max_context_tokens
        self.metrics = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

        # Injected callable for step-3 summarization. If None, step 3 is
        # skipped and step 2 is the final fallback (safe for unit tests
        # that don't have a provider available).
        self._summarize_fn = summarize_fn

        try:
            self._encoding = tiktoken.encoding_for_model("gpt-4o")
        except KeyError:
            self._encoding = tiktoken.get_encoding("cl100k_base")

    def track_burn(self, usage: Any) -> None:
        """Add this API response's usage to running totals.

        Only prints when the cumulative input tokens exceed 60% of the
        budget — quiet during normal operation, visible when approaching
        the compaction threshold.
        """
        self.metrics["input_tokens"] += usage.prompt_tokens
        self.metrics["output_tokens"] += usage.completion_tokens
        self.metrics["total_tokens"] += usage.total_tokens

        pct = self.metrics["input_tokens"] / self.max_context_tokens
        if pct >= 0.60:
            logger.info(
                "token budget %.0f%% — in: %d / %d | out: %d",
                pct * 100,
                self.metrics["input_tokens"],
                self.max_context_tokens,
                self.metrics["output_tokens"],
            )

    def enforce_compaction(self, history: list, tool_use: Any) -> list:
        """Return a (possibly compacted) view of ``history`` under the budget.

        Does NOT mutate ``history``. Applies the three-step strategy in
        order, returning early as soon as the result fits the budget:

        1. Evict raw tool payloads (replace ``tool`` message content with a
           short placeholder; preserves message structure so tool_call/
           tool_response pairs still validate).
        2. Keep only the last 4 *groups*.
        3. Summarize everything between the system seed and the kept tail
           into a single synthetic system message.

        ``tool_use`` is unread but kept on the signature as a deliberate
        forward hook for future tool-aware compaction strategies.
        """
        del tool_use  # forward-compat hook; intentionally unused for now

        before_msgs = len(history)
        before_tokens = self._estimate_tokens(history)

        if before_tokens <= self.max_context_tokens:
            return history

        # ---- Step 1: replace tool result payloads with a placeholder. ----
        step1: list[dict] = []
        for msg in history:
            if msg.get("role") == "tool":
                step1.append({**msg, "content": "[tool result evicted]"})
            else:
                step1.append(msg)
        if self._estimate_tokens(step1) <= self.max_context_tokens:
            logger.info(
                "compaction step 1: %d msgs / %d tok → %d msgs / %d tok",
                before_msgs, before_tokens, len(step1), self._estimate_tokens(step1),
            )
            return step1

        # ---- Step 2: keep last 4 groups (atomic tool round-trips). ----
        system_msg: dict | None = None
        body_start = 0
        if step1 and step1[0].get("role") == "system":
            system_msg = step1[0]
            body_start = 1
        body = step1[body_start:]
        last_groups_flat = _keep_last_n_groups(body, n=4)
        step2 = ([system_msg] if system_msg else []) + last_groups_flat
        if self._estimate_tokens(step2) <= self.max_context_tokens:
            logger.info(
                "compaction step 2: %d msgs / %d tok → %d msgs / %d tok",
                before_msgs, before_tokens, len(step2), self._estimate_tokens(step2),
            )
            return step2

        # ---- Step 3: summarize the discarded middle into one message. ----
        kept_tail_len = len(last_groups_flat)
        middle = body[: len(body) - kept_tail_len]
        if not middle:
            logger.info(
                "compaction step 2 only (nothing to summarize): "
                "%d msgs / %d tok → %d msgs / %d tok",
                before_msgs, before_tokens, len(step2), self._estimate_tokens(step2),
            )
            return step2

        summary = self._summarize(middle)
        summary_msg = {
            "role": "system",
            "content": f"Previous context summary: {summary}",
        }
        result = ([system_msg] if system_msg else []) + [summary_msg] + last_groups_flat
        logger.info(
            "compaction step 3 (summarized): %d msgs / %d tok → %d msgs / %d tok",
            before_msgs, before_tokens, len(result), self._estimate_tokens(result),
        )
        return result

    def _summarize(self, history: list) -> str:
        """Compress ``history`` into a short summary via the injected callable."""
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

        prompt = (
            "Summarize the following conversation history "
            "concisely, preserving key facts, decisions, and "
            "tool results:\n" + history_text
        )
        return self._summarize_fn(prompt)  # type: ignore[misc]

    def _estimate_tokens(self, context: list) -> int:
        """Sum tiktoken-measured token counts across every message."""
        total = 0
        for msg in context:
            try:
                serialized = json.dumps(msg, default=str)
            except (TypeError, ValueError):
                serialized = str(msg)
            total += len(self._encoding.encode(serialized))
        return total


def _keep_last_n_groups(messages: list, n: int) -> list:
    """Return the last ``n`` conversation groups as a flat list of messages.

    A "group" is either:
    - a single non-tool message (user, assistant text, etc.), OR
    - an assistant message with ``tool_calls`` plus every immediately
      following ``tool`` message (its results).

    This guarantees we never split a tool-call/tool-result pair across
    the eviction boundary, which would produce orphan tool messages and
    cause the OpenAI API to reject the next request.
    """
    groups: list[list[dict]] = []
    current: list[dict] = []

    for msg in messages:
        role = msg.get("role")
        if role == "tool":
            if not current:
                current = [msg]
            else:
                current.append(msg)
        else:
            if current:
                groups.append(current)
            current = [msg]
    if current:
        groups.append(current)

    kept_groups = groups[-n:]
    return [m for g in kept_groups for m in g]
