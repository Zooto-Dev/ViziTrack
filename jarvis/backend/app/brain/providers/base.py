"""Common provider interface.

Every provider turns a neutral message list + tool schemas into a stream of
``StreamEvent`` objects.  The agent loop above it never sees provider
specifics, so switching Ollama <-> Groq <-> Claude is a settings change.

Neutral message format (what the agent stores in history):
    {"role": "system"|"user"|"assistant", "content": str}
    {"role": "assistant", "content": str|None, "tool_calls": [{"id","name","args"}]}
    {"role": "tool", "tool_call_id": str, "name": str, "content": str}
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict[str, Any]
    # Provider data that must be sent back with this call (Gemini thought signatures).
    extra: dict[str, Any] | None = None


@dataclass
class StreamEvent:
    type: Literal["text", "tool_call", "done", "error"]
    text: str = ""
    tool_call: ToolCall | None = None
    finish_reason: str = ""
    usage: dict[str, int] = field(default_factory=dict)
    error: str = ""


class ProviderError(RuntimeError):
    """Raised for configuration/network problems; message is user-facing."""


class TooLarge(ProviderError):
    """The request is bigger than the provider allows (e.g. a free-tier token cap)."""


class Unavailable(ProviderError):
    """Network down or the provider's servers failing; worth trying another provider."""


class SignatureRejected(ProviderError):
    """Gemini refused function calls in the history (thought signature check)."""


class RateLimited(ProviderError):
    """Too many tokens/requests this minute. ``retry_after`` is seconds, if known."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class LLMProvider(abc.ABC):
    name: str = "base"
    supports_tools: bool = True
    # How much earlier conversation to send, in (estimated) tokens.
    history_tokens: int = 6000
    # A tool result in the current turn is cut to this many characters.
    tool_result_chars: int = 8000
    # Send only the tools that fit the message (for small free-tier limits).
    lean_tools: bool = False

    @abc.abstractmethod
    def stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        *,
        system: str | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Yield text deltas and tool calls, ending with a ``done`` event."""

    @abc.abstractmethod
    async def check(self) -> dict[str, Any]:
        """Cheap reachability/config check. Returns {ok, detail, models?}."""

    def describe(self) -> str:
        return self.name
