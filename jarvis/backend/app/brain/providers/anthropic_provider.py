"""Anthropic Claude via the official SDK (optional, needs a paid key).

Uses ``messages.stream`` with adaptive thinking, prompt caching on the
system prompt + tools, and the server-side refusal fallback.
"""

from __future__ import annotations

from typing import Any, AsyncIterator

from .base import LLMProvider, ProviderError, StreamEvent, ToolCall


def to_anthropic_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        role = m["role"]
        if role == "system":
            continue  # handled via the top-level system param
        if role == "assistant" and m.get("tool_calls"):
            content: list[dict[str, Any]] = []
            if m.get("content"):
                content.append({"type": "text", "text": m["content"]})
            for tc in m["tool_calls"]:
                content.append({"type": "tool_use", "id": tc["id"], "name": tc["name"], "input": tc["args"]})
            out.append({"role": "assistant", "content": content})
        elif role == "tool":
            block = {"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m["content"]}
            # Consecutive tool results must share one user message.
            if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list):
                out[-1]["content"].append(block)
            else:
                out.append({"role": "user", "content": [block]})
        else:
            out.append({"role": role, "content": m.get("content", "")})
    return out


class AnthropicProvider(LLMProvider):
    name = "anthropic"
    history_tokens = 30000
    tool_result_chars = 20000

    def __init__(self, api_key: str, model: str = "claude-opus-5-5", timeout_s: float = 120, max_tokens: int = 1024) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_s = timeout_s
        self.max_tokens = max(max_tokens, 1024)

    def describe(self) -> str:
        return f"anthropic:{self.model}"

    def _client(self):  # noqa: ANN202
        try:
            import anthropic
        except ImportError as e:  # pragma: no cover
            raise ProviderError(
                "Claude ke liye 'anthropic' package chahiye. backend folder me chalao: .venv\\Scripts\\pip install anthropic"
            ) from e
        if not self.api_key:
            raise ProviderError("No Anthropic API key set. Add it in Settings or ANTHROPIC_API_KEY.")
        return anthropic.AsyncAnthropic(api_key=self.api_key, timeout=self.timeout_s)

    async def check(self) -> dict[str, Any]:
        try:
            client = self._client()
            page = await client.models.list(limit=50)
            ids = [m.id for m in page.data]
            return {"ok": True, "detail": f"Connected to Anthropic. Using {self.model}.", "models": ids}
        except ProviderError as e:
            return {"ok": False, "detail": str(e)}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "detail": f"Anthropic: {type(e).__name__}: {e}"}

    async def stream(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None, *, system: str | None = None
    ) -> AsyncIterator[StreamEvent]:
        client = self._client()  # raises a friendly ProviderError if the package is missing
        import anthropic

        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": to_anthropic_messages(messages),
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": "low"},  # voice assistant: fast, short answers
            "betas": ["server-side-fallback-2026-07-01"],
            "fallbacks": "default",
        }
        if system:
            kwargs["system"] = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        if tools:
            kwargs["tools"] = tools
        try:
            async with client.beta.messages.stream(**kwargs) as stream:
                async for event in stream:
                    if event.type == "text":
                        yield StreamEvent("text", text=event.text)
                final = await stream.get_final_message()
        except anthropic.AuthenticationError as e:
            raise ProviderError("Anthropic rejected the API key (401).") from e
        except anthropic.RateLimitError as e:
            raise ProviderError("Anthropic rate limit reached (429). Try again shortly.") from e
        except anthropic.APIStatusError as e:
            raise ProviderError(f"Anthropic error {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise ProviderError("Cannot reach Anthropic. Check your internet connection.") from e

        if final.stop_reason == "refusal":
            yield StreamEvent("error", error="Claude declined this request.")
        for block in final.content:
            if block.type == "tool_use":
                args = block.input if isinstance(block.input, dict) else {}
                yield StreamEvent("tool_call", tool_call=ToolCall(id=block.id, name=block.name, args=args))
        usage = {"input": final.usage.input_tokens, "output": final.usage.output_tokens}
        if getattr(final.usage, "cache_read_input_tokens", None):
            usage["cache_read"] = final.usage.cache_read_input_tokens
        finish = "tool_calls" if final.stop_reason == "tool_use" else (final.stop_reason or "stop")
        yield StreamEvent("done", finish_reason=finish, usage=usage)

