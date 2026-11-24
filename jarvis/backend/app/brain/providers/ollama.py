"""Ollama native API (``/api/chat``) with streaming and tool calling.

Free and fully offline.  Tool calling needs a model trained for it
(qwen2.5, llama3.1+, mistral-nemo, ...).  Ollama does not stream tool
calls token by token: they arrive as complete objects, which we forward.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from .base import LLMProvider, ProviderError, StreamEvent, ToolCall
from .openai_compat import to_openai_messages

NOT_RUNNING = (
    "Ollama is not running on {url}. Install it from ollama.com, then run `ollama pull {model}` once and "
    "keep the Ollama app running."
)


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, base_url: str, model: str, timeout_s: float = 120, max_tokens: int = 1024) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_s = timeout_s
        self.max_tokens = max_tokens

    def describe(self) -> str:
        return f"ollama:{self.model}"

    async def check(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{self.base_url}/api/tags")
                r.raise_for_status()
                models = [m["name"] for m in r.json().get("models", [])]
        except httpx.HTTPError:
            return {"ok": False, "detail": NOT_RUNNING.format(url=self.base_url, model=self.model), "models": []}
        have = any(m == self.model or m.split(":")[0] == self.model.split(":")[0] for m in models)
        if not have:
            return {
                "ok": False,
                "detail": f"Ollama is running but model '{self.model}' is not downloaded. Run: ollama pull {self.model}",
                "models": models,
            }
        return {"ok": True, "detail": f"Ollama ready with {self.model}.", "models": models}

    async def stream(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None, *, system: str | None = None
    ) -> AsyncIterator[StreamEvent]:
        msgs = to_openai_messages(messages, system)
        # Ollama wants tool_call arguments as objects, not JSON strings.
        for m in msgs:
            for tc in m.get("tool_calls") or []:
                fn = tc["function"]
                if isinstance(fn.get("arguments"), str):
                    try:
                        fn["arguments"] = json.loads(fn["arguments"])
                    except json.JSONDecodeError:
                        fn["arguments"] = {}
        body: dict[str, Any] = {
            "model": self.model,
            "messages": msgs,
            "stream": True,
            "options": {"num_predict": self.max_tokens},
        }
        if tools:
            body["tools"] = tools
        usage: dict[str, int] = {}
        n = 0
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(self.timeout_s, connect=5)) as client:
                async with client.stream("POST", f"{self.base_url}/api/chat", json=body) as resp:
                    if resp.status_code >= 400:
                        text = (await resp.aread()).decode("utf-8", "replace")
                        if "not found" in text.lower():
                            raise ProviderError(
                                f"Model '{self.model}' is not downloaded in Ollama. Run: ollama pull {self.model}"
                            )
                        if "does not support tools" in text.lower():
                            raise ProviderError(
                                f"Model '{self.model}' cannot use tools. Use qwen2.5:7b, llama3.1 or mistral-nemo."
                            )
                        raise ProviderError(f"Ollama error {resp.status_code}: {text[:300]}")
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if chunk.get("error"):
                            raise ProviderError(f"Ollama: {chunk['error']}")
                        msg = chunk.get("message") or {}
                        if msg.get("content"):
                            yield StreamEvent("text", text=msg["content"])
                        for tc in msg.get("tool_calls") or []:
                            fn = tc.get("function") or {}
                            args = fn.get("arguments") or {}
                            if isinstance(args, str):
                                try:
                                    args = json.loads(args)
                                except json.JSONDecodeError:
                                    args = {}
                            n += 1
                            yield StreamEvent(
                                "tool_call",
                                tool_call=ToolCall(id=tc.get("id") or f"call_{n}", name=fn.get("name", ""), args=args),
                            )
                        if chunk.get("done"):
                            usage = {
                                "input": chunk.get("prompt_eval_count", 0),
                                "output": chunk.get("eval_count", 0),
                            }
        except httpx.ConnectError as e:
            raise ProviderError(NOT_RUNNING.format(url=self.base_url, model=self.model)) from e
        except httpx.HTTPError as e:
            raise ProviderError(f"Network problem talking to Ollama: {e.__class__.__name__}") from e
        yield StreamEvent("done", finish_reason="tool_calls" if n else "stop", usage=usage)
