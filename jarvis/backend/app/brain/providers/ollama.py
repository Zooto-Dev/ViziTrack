"""Ollama native API (``/api/chat``) with streaming and tool calling.

Free and fully offline.  Tool calling needs a model trained for it
(qwen2.5, llama3.1+, mistral-nemo, ...).

Speed on a CPU-only laptop is dominated by two things, both handled here:
* loading the model into RAM: we keep it loaded (``keep_alive``) and load it
  in the background as soon as Jarvis starts (``warmup``);
* reading the system prompt + tool list: ``warmup`` sends exactly the same
  prefix once, so Ollama caches it and later messages only process the new
  words.  Options must match between warmup and chat or Ollama reloads.
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
KEEP_ALIVE = "60m"
NUM_CTX = 8192  # room for prompt + tools + recent conversation; Ollama silently drops the start if exceeded
# CPU-only machines can take minutes on the very first request.
READ_TIMEOUT = 600.0


class OllamaProvider(LLMProvider):
    name = "ollama"
    history_tokens = 2500  # a CPU reads every token, so keep the context modest
    tool_result_chars = 6000

    def __init__(self, base_url: str, model: str, timeout_s: float = 120, max_tokens: int = 1024) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_s = max(timeout_s, READ_TIMEOUT)
        self.max_tokens = max_tokens

    def describe(self) -> str:
        return f"ollama:{self.model}"

    def _options(self, num_predict: int) -> dict[str, Any]:
        return {"num_predict": num_predict, "num_ctx": NUM_CTX}

    def _body(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None, system: str | None) -> dict[str, Any]:
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
        body: dict[str, Any] = {"model": self.model, "messages": msgs, "keep_alive": KEEP_ALIVE}
        if tools:
            body["tools"] = tools
        return body

    async def check(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{self.base_url}/api/tags")
                r.raise_for_status()
                models = [m["name"] for m in r.json().get("models", [])]
        except httpx.HTTPError:
            return {"ok": False, "detail": NOT_RUNNING.format(url=self.base_url, model=self.model), "models": []}
        have = any(m == self.model or m == f"{self.model}:latest" for m in models)
        if not have:
            hint = f" Downloaded models: {', '.join(models)}." if models else ""
            return {
                "ok": False,
                "detail": f"Model '{self.model}' is not downloaded. Run: ollama pull {self.model}.{hint}",
                "models": models,
            }
        return {"ok": True, "detail": f"Ollama ready with {self.model}.", "models": models}

    async def warmup(self, system: str | None, tools: list[dict[str, Any]] | None) -> bool:
        """Load the model and cache the prompt prefix. Safe to call any time."""
        body = self._body([{"role": "user", "content": "hi"}], tools, system)
        body["stream"] = False
        body["options"] = self._options(1)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(READ_TIMEOUT, connect=5)) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=body)
            return r.status_code < 400
        except httpx.HTTPError:
            return False

    async def stream(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None, *, system: str | None = None
    ) -> AsyncIterator[StreamEvent]:
        body = self._body(messages, tools, system)
        body["stream"] = True
        body["options"] = self._options(self.max_tokens)
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
                                f"Model '{self.model}' cannot use tools. Use qwen2.5:3b, qwen2.5:7b or llama3.1."
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
        except httpx.ReadTimeout as e:
            raise ProviderError(
                "Ollama took too long to answer. This PC may be too slow for this model; try a smaller one "
                "(ollama pull qwen2.5:1.5b) or the free Groq provider."
            ) from e
        except httpx.HTTPError as e:
            raise ProviderError(f"Network problem talking to Ollama: {e.__class__.__name__}") from e
        yield StreamEvent("done", finish_reason="tool_calls" if n else "stop", usage=usage)
