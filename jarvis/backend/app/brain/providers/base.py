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


class LLMProvider(abc.ABC):
    name: str = "base"
    supports_tools: bool = True

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
