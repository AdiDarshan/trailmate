"""Safety and validation layer for AI requests and responses.

Pydantic models act as the contract between the core app and the AI
service, and between the AI service and the provider. Invalid data is
rejected at the boundary rather than propagating silently.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, field_validator


class ChatRequest(BaseModel):
    """Validated input to the AI service."""

    messages: list[dict]
    tools: Optional[list[dict]] = None

    @field_validator("messages")
    @classmethod
    def messages_not_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("messages cannot be empty")
        return v


class ChatResponse(BaseModel):
    """Validated output from the AI provider.

    Wraps the relevant fields of an OpenAI message so the service layer
    never touches raw SDK objects directly.
    """

    content: Optional[str] = None
    tool_calls: Optional[list[Any]] = None

    model_config = {"arbitrary_types_allowed": True}

    @field_validator("content")
    @classmethod
    def content_within_limits(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 100_000:
            raise ValueError("Response content exceeds 100k character safety limit")
        return v
