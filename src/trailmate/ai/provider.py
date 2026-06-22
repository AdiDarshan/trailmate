"""LLM Provider Client — the only place in the codebase that imports the OpenAI SDK.

Responsibilities:
- Reads ``OPENAI_API_KEY`` from the environment (via ``OpenAI()`` defaults).
- Wraps ``chat.completions.create`` with a stable internal interface.
- Provides a cheap ``summarize`` helper used by ``ContextManager``.

Nothing above this layer (service, harness, tools) should import ``openai``.
"""

from __future__ import annotations

from typing import Any

from openai import OpenAI


class LLMProvider:
    """Thin wrapper around the OpenAI chat completions API.

    All provider-specific request/response shaping is contained here.
    The ``chat`` method returns the raw SDK response object so callers
    can inspect ``usage``, ``choices``, etc. without this class needing
    to know what they care about.
    """

    def __init__(self, model: str = "gpt-4o") -> None:
        # OpenAI() reads OPENAI_API_KEY from env at construction time.
        self._client = OpenAI()
        self.model = model

    def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
    ) -> Any:
        """Call the chat completions API and return the raw response.

        Args:
            messages: Full conversation history in OpenAI message format.
            tools: Optional list of tool schemas to advertise to the model.

        Returns:
            The raw ``openai.types.chat.ChatCompletion`` response object.
        """
        kwargs: dict[str, Any] = {"model": self.model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        return self._client.chat.completions.create(**kwargs)

    def summarize(self, prompt: str) -> str:
        """Compress text using a cheap model. Used by ContextManager step 3.

        Args:
            prompt: The full text to summarize (rendered conversation history).

        Returns:
            A short summary string, or an empty string if the model returns none.
        """
        response = self._client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
        )
        return response.choices[0].message.content or ""
