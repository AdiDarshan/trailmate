"""AI Service — the chat loop that wires provider, tools, and context together.

The core app (AgentHarness) tells this service *what* to do (run a user
prompt); the service decides *how* — which messages to send, when to call
tools, and when to stop. The service never imports OpenAI directly; all
LLM calls go through ``LLMProvider``.
"""

from __future__ import annotations

import json

from trailmate.ai.context import ContextManager
from trailmate.ai.provider import LLMProvider
from trailmate.ai.validation import ChatRequest, ChatResponse
from trailmate.tools.registry import ToolRegistry


class AIService:
    """Bounded chat loop around an LLMProvider.

    The loop terminates as soon as the model returns a final assistant
    message with no ``tool_calls``. Raises ``TimeoutError`` if it never
    does within ``max_iterations``.
    """

    def __init__(
        self,
        provider: LLMProvider,
        tool_registry: ToolRegistry,
        system_prompt: str,
        max_iterations: int = 10,
        max_context_tokens: int = 32_000,
    ) -> None:
        self.provider = provider
        self.tools = tool_registry
        self.max_iterations = max_iterations

        # Conversation history. Seeded with the system prompt so the agent
        # has its identity from turn 1.
        self.chat_history: list[dict] = [{"role": "system", "content": system_prompt}]

        # Low-level audit trail of every raw model response, indexed by
        # iteration. Useful for debugging tool-calling behaviour.
        self.trajectory_log: list[dict] = []

        # Forward hook for tool-aware context compaction.
        self.tool_use: list[dict] = []

        # Token accounting + compaction. Summarization is delegated to the
        # provider so ContextManager stays free of LLM SDK imports.
        self.context_manager = ContextManager(
            max_context_tokens=max_context_tokens,
            summarize_fn=provider.summarize,
        )

    def run(self, user_prompt: str) -> str:
        """Drive the loop until the model emits a final answer.

        Validates the request via ``ChatRequest`` before sending and the
        response via ``ChatResponse`` after receiving. Returns the
        assistant's final text.
        """
        self.chat_history.append({"role": "user", "content": user_prompt})

        for iteration in range(1, self.max_iterations + 1):
            # Assemble and compact the context for this iteration.
            raw_context = list(self.chat_history)
            compacted = self.context_manager.enforce_compaction(raw_context, self.tool_use)

            # Validate the outgoing request.
            request = ChatRequest(
                messages=compacted,
                tools=self.tools.get_tool_schemas() or None,
            )

            # Call the provider.
            raw_response = self.provider.chat(request.messages, request.tools)
            self.context_manager.track_burn(raw_response.usage)

            message = raw_response.choices[0].message
            self.trajectory_log.append(
                {"iteration": iteration, "response": message.to_dict()}
            )

            # Validate the incoming response.
            validated = ChatResponse(
                content=message.content,
                tool_calls=message.tool_calls,
            )

            if validated.tool_calls:
                # Persist the assistant turn (with tool_calls) before posting
                # results; the API requires the matching assistant message.
                self.chat_history.append(message.to_dict())

                for tool_call in validated.tool_calls:
                    name = tool_call.function.name
                    args = tool_call.function.arguments
                    result = self.tools.execute(name, args)
                    self.chat_history.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": json.dumps(result),
                        }
                    )
                    self.tool_use.append(
                        {"name": name, "tool_call_id": tool_call.id, "iteration": iteration}
                    )
                continue

            if validated.content and not validated.tool_calls:
                self.chat_history.append(
                    {"role": "assistant", "content": validated.content}
                )
                return validated.content

            # Model emitted neither tool calls nor content (rare). Spin
            # until max_iterations.

        raise TimeoutError("Agent exceeded maximum execution trajectory depth.")

    def compile_context(self) -> list[dict]:
        """Return a shallow copy of ``chat_history`` for the next API call."""
        return list(self.chat_history)
