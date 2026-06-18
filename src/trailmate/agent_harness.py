"""Iterative agent harness driving an OpenAI chat model in a bounded loop.

Wires together the three pieces of TrailMate's agent runtime:
- `ToolRegistry`   — local Python functions exposed to the model
- `ContextManager` — token accounting + tiered compaction under a budget
- the chat loop itself, which alternates LLM calls with tool dispatches
  until the model returns a final, tool-call-free message.
"""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from trailmate.context_manager import ContextManager
from trailmate.tool_registry import ToolRegistry

# Base identity and behaviour instructions. Per-skill routing instructions are
# injected dynamically from SKILL.md files at harness construction time so that
# adding a new skill directory is enough to make it available — no code change
# required.
TRAILMATE_SYSTEM_PROMPT = (
    "You are TrailMate, an AI travel companion specializing in Israel. "
    "You have access to tools — use them instead of answering from memory. "
    "Be concise. Prefer specific recommendations over vague advice. "
    "Admit when you don't have information rather than inventing it. "
    "When presenting a trip itinerary, format each day clearly with trail, meals, "
    "attraction, and weather. "
    "Always present every location as a Google Maps link using this format: "
    "[📍 Place Name](https://www.google.com/maps?q=LAT,LNG) — "
    "never show raw coordinates."
)

# Skills live one level below this directory: <project_root>/.agents/skills/<name>/SKILL.md
_SKILLS_DIR = Path(__file__).parent.parent.parent / ".agents" / "skills"


def _load_skills_block(skills_dir: Path) -> str:
    """Scan *skills_dir* for SKILL.md files and return an ``<available_skills>`` block.

    Walks one level deep — each immediate subdirectory of *skills_dir* that
    contains a ``SKILL.md`` is treated as one skill. Skills are sorted by
    directory name for a stable ordering across runs. Returns an empty string
    if *skills_dir* doesn't exist or contains no ``SKILL.md`` files, so the
    caller can safely concatenate the result without a special-case check.
    """
    if not skills_dir.is_dir():
        return ""

    blocks: list[str] = []
    for skill_dir in sorted(skills_dir.iterdir()):
        skill_md = skill_dir / "SKILL.md"
        if not skill_dir.is_dir() or not skill_md.exists():
            continue
        content = skill_md.read_text(encoding="utf-8")
        # Include the skill's path relative to the project root so the LLM
        # can construct the correct argument to run_script without guessing.
        rel_path = skill_dir.relative_to(skills_dir.parent.parent)
        blocks.append(
            f'<skill name="{skill_dir.name}" path="{rel_path}">\n{content}\n</skill>'
        )

    if not blocks:
        return ""

    return "<available_skills>\n" + "\n".join(blocks) + "\n</available_skills>"


class AgentHarness:
    """Bounded chat loop around an OpenAI model.

    The loop terminates as soon as the model returns a final assistant
    message with no `tool_calls`. If it never does within
    `max_iterations`, a `TimeoutError` is raised.
    """

    def __init__(self, model: str = "gpt-4o") -> None:
        # OpenAI() reads OPENAI_API_KEY from the environment at construction
        # time; load_dotenv() must have already run before instantiating.
        self.client = OpenAI()
        self.model = model

        # Build the system prompt once at startup. The base identity string
        # is extended with today's date (so relative dates like "tomorrow"
        # resolve correctly) and a dynamically-scanned <available_skills> block.
        today_str = date.today().isoformat()
        skills_block = _load_skills_block(_SKILLS_DIR)
        date_line = f"Today's date is {today_str}."
        system_content = TRAILMATE_SYSTEM_PROMPT + "\n\n" + date_line
        if skills_block:
            system_content += "\n\n" + skills_block

        # Conversation history. Seeded with a single system message so
        # the agent has its identity from turn 1; user/assistant/tool
        # messages are appended as the loop runs.
        self.chat_history: list[dict] = [
            {"role": "system", "content": system_content}
        ]

        # Low-level audit trail of every raw model response, indexed by
        # iteration. Useful for debugging tool-calling behavior later.
        self.trajectory_log: list[dict] = []

        self.max_iterations = 10

        # Tool registry advertised to the model on every call. Comes
        # pre-populated with the project's built-in tools (see
        # `ToolRegistry._init_tools`); callers can `harness.tools.register(...)`
        # to add more before invoking `run`.
        self.tools = ToolRegistry()

        # Forward hook for tool-aware context compaction. One entry per
        # tool execution: {"name", "tool_call_id", "iteration"}. Currently
        # passed through to ContextManager but unread there; reserved for
        # future strategies like "always preserve the most recent result
        # of each unique tool".
        self.tool_use: list[dict] = []

        # Token accounting + compaction under a budget. The 3000 ceiling
        # is deliberately low — it's a development trigger so compaction
        # is observable in normal sessions. For real usage, raise to e.g.
        # 32000 (gpt-4o supports up to 128k input tokens).
        self.context_manager = ContextManager(max_context_tokens=32000)

    def run(self, user_prompt: str) -> str:
        """Drive the loop until the model emits a final answer.

        Returns the assistant's final text. Raises `TimeoutError` if the
        loop hits `max_iterations` without the model producing a final,
        tool-call-free message.
        """
        # Step 1: record the user's turn in the conversation history so
        # the model can see it on this and every subsequent iteration.
        self.chat_history.append({"role": "user", "content": user_prompt})

        iteration = 0
        while iteration < self.max_iterations:
            iteration += 1

            # Step 2: assemble the messages and apply compaction. The
            # compactor returns a one-shot view; `self.chat_history` is
            # never mutated, so subsequent iterations always start from
            # the full record.
            raw_context = self._compile_context()
            chat_history_compacted = self.context_manager.enforce_compaction(
                raw_context, self.tool_use
            )

            # Step 3: raw API call. `tools=` advertises every callable
            # in the registry; the model decides whether to use one.
            response = self.client.chat.completions.create(
                model=self.model,
                messages=chat_history_compacted,
                tools=self.tools.get_tool_schemas(),
            )

            # Step 3b: account for what we just spent. track_burn also
            # prints a one-line summary so the REPL user can see drift.
            self.context_manager.track_burn(response.usage)

            # Step 4: extract the single message from the first choice.
            # We only ever request n=1 so choices[0] is the only choice.
            message = response.choices[0].message

            # Step 5: log the raw response for this iteration. .to_dict()
            # gives us a JSON-friendly snapshot independent of the SDK's
            # pydantic model class.
            self.trajectory_log.append(
                {"iteration": iteration, "response": message.to_dict()}
            )

            # Condition 2 — the model asked to call one or more tools.
            # We must persist the assistant turn (with tool_calls intact)
            # before posting tool results, otherwise the API rejects the
            # next request: every "tool" message must be preceded by an
            # "assistant" message that contains the matching tool_call_id.
            if message.tool_calls:
                self.chat_history.append(message.to_dict())

                for tool_call in message.tool_calls:
                    tool_name = tool_call.function.name
                    tool_args = tool_call.function.arguments
                    result = self.tools.execute(tool_name, tool_args)
                    # Tool result content must be a string. JSON-encoding
                    # keeps structured results legible to the model.
                    self.chat_history.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": json.dumps(result),
                        }
                    )
                    # Record the call for tool-aware compaction (Q3).
                    self.tool_use.append(
                        {
                            "name": tool_name,
                            "tool_call_id": tool_call.id,
                            "iteration": iteration,
                        }
                    )
                # Loop again so the model can read the tool output and
                # produce its next move (another tool call or a final
                # answer).
                continue

            # Condition 1 — final answer. The model produced text AND
            # asked for no tools. Persist the assistant turn and return.
            if message.content and not message.tool_calls:
                self.chat_history.append(
                    {"role": "assistant", "content": message.content}
                )
                return message.content

            # If we got here, the model emitted neither tool calls nor
            # final content (rare — e.g. an empty refusal). Spin until
            # max_iterations rather than returning an empty string.

        raise TimeoutError("Agent exceeded maximum execution trajectory depth.")

    def _compile_context(self) -> list[dict]:
        """Return a fresh shallow copy of `chat_history` for the next API call.

        The system prompt now lives at `chat_history[0]` (seeded in
        `__init__`), so this method is a thin pass-through. The shallow
        copy keeps `ContextManager.enforce_compaction` from accidentally
        seeing later mutations to `chat_history` while it's deciding
        what to compact.
        """
        return list(self.chat_history)


def run_repl() -> None:
    """Interactive REPL around a single `AgentHarness` instance.

    The harness is created once outside the loop so `chat_history`
    persists across turns — the agent remembers what you said earlier
    in the same session. Used by both `python -m trailmate` and
    `python -m trailmate.agent_harness`.
    """
    load_dotenv()
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit(
            "OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in."
        )

    harness = AgentHarness()
    print("TrailMate agent ready. Type a message; 'exit', 'quit', or Ctrl+D to leave.\n")

    while True:
        try:
            user_input = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            # Ctrl+D / Ctrl+C at the prompt → leave the session cleanly.
            print()
            break

        if not user_input:
            # Empty line: just re-prompt without bothering the model.
            continue
        if user_input.lower() in {"exit", "quit"}:
            break

        try:
            answer = harness.run(user_input)
        except Exception as exc:
            # Don't crash the whole session on a transient API error.
            print(f"[error] {exc}\n")
            # The user message was already appended by run() before the
            # call failed; drop it so history stays a clean alternation.
            if harness.chat_history and harness.chat_history[-1].get("role") == "user":
                harness.chat_history.pop()
            continue

        print(f"agent> {answer}\n")


if __name__ == "__main__":
    run_repl()
