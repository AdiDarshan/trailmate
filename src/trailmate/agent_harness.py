"""Core app orchestration layer for TrailMate.

This module knows *what* needs to be done (build a system prompt, create
an AI service, run a user turn) but does NOT know how to talk to OpenAI
directly. All LLM calls go through ``ai.service.AIService``, which
delegates to ``ai.provider.LLMProvider``.
"""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

from trailmate.ai.provider import LLMProvider
from trailmate.ai.service import AIService
from trailmate.tools.registry import ToolRegistry

# Base identity and behaviour instructions. Per-skill routing instructions
# are injected dynamically from SKILL.md files at construction time.
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

    Walks one level deep — each immediate subdirectory containing a
    ``SKILL.md`` is treated as one skill. Returns an empty string if
    *skills_dir* doesn't exist or contains no ``SKILL.md`` files.
    """
    if not skills_dir.is_dir():
        return ""

    blocks: list[str] = []
    for skill_dir in sorted(skills_dir.iterdir()):
        skill_md = skill_dir / "SKILL.md"
        if not skill_dir.is_dir() or not skill_md.exists():
            continue
        content = skill_md.read_text(encoding="utf-8")
        rel_path = skill_dir.relative_to(skills_dir.parent.parent)
        blocks.append(
            f'<skill name="{skill_dir.name}" path="{rel_path}">\n{content}\n</skill>'
        )

    if not blocks:
        return ""

    return "<available_skills>\n" + "\n".join(blocks) + "\n</available_skills>"


def _build_system_prompt() -> str:
    """Compose the full system prompt from the base string + date + skills."""
    today_str = date.today().isoformat()
    skills_block = _load_skills_block(_SKILLS_DIR)
    prompt = TRAILMATE_SYSTEM_PROMPT + "\n\n" + f"Today's date is {today_str}."
    if skills_block:
        prompt += "\n\n" + skills_block
    return prompt


class AgentHarness:
    """Core app entry point — constructs the AI service and drives conversations.

    The harness is responsible for:
    - Building the system prompt (business knowledge: what to tell the AI).
    - Wiring together the provider, tool registry, and service.
    - Exposing a simple ``run(user_prompt)`` interface to callers.

    It does NOT contain any LLM API calls or OpenAI-specific logic.
    """

    def __init__(self, model: str = "gpt-4o") -> None:
        self.model = model

        provider = LLMProvider(model=model)
        tool_registry = ToolRegistry()
        system_prompt = _build_system_prompt()

        self._service = AIService(
            provider=provider,
            tool_registry=tool_registry,
            system_prompt=system_prompt,
            max_context_tokens=100_000,  # GPT-4o supports 128k; compact only when truly needed
        )

    # ── Delegating properties (backward compat for tests and ui/app.py) ──

    @property
    def chat_history(self) -> list[dict]:
        return self._service.chat_history

    @property
    def trajectory_log(self) -> list[dict]:
        return self._service.trajectory_log

    @property
    def tool_use(self) -> list[dict]:
        return self._service.tool_use

    @property
    def max_iterations(self) -> int:
        return self._service.max_iterations

    @property
    def context_manager(self):
        return self._service.context_manager

    @property
    def tools(self) -> ToolRegistry:
        return self._service.tools

    # ─────────────────────────────────────────────────────────────────────

    def run(self, user_prompt: str) -> str:
        """Drive the agent loop for one user turn and return the final answer."""
        return self._service.run(user_prompt)

    def _compile_context(self) -> list[dict]:
        """Return a fresh shallow copy of ``chat_history`` for the next API call."""
        return self._service.compile_context()


def run_repl() -> None:
    """Interactive REPL around a single ``AgentHarness`` instance.

    The harness is created once outside the loop so ``chat_history``
    persists across turns.
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
            print()
            break

        if not user_input:
            continue
        if user_input.lower() in {"exit", "quit"}:
            break

        try:
            answer = harness.run(user_input)
        except Exception as exc:
            print(f"[error] {exc}\n")
            if harness.chat_history and harness.chat_history[-1].get("role") == "user":
                harness.chat_history.pop()
            continue

        print(f"agent> {answer}\n")


if __name__ == "__main__":
    run_repl()
