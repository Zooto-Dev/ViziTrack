"""OpenAI-compatible chat completions (Groq, Gemini, OpenRouter, LM Studio, vLLM...).

Streams ``/v1/chat/completions`` with ``stream: true`` and assembles
tool-call argument fragments per index.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

import re

from .base import LLMProvider, ProviderError, RateLimited, SignatureRejected, StreamEvent, ToolCall, TooLarge, Unavailable


def _note_args(args: dict[str, Any]) -> str:
    text = json.dumps(args, ensure_ascii=False)
    return text if len(text) <= 200 else text[:200] + "...}"


def to_openai_messages(
    messages: list[dict[str, Any]], system: str | None, *, gemini: bool = False, flatten_all: bool = False
) -> list[dict[str, Any]]:
    """Neutral history -> OpenAI chat messages.

    Gemini (thinking models) rejects a function call in the history unless it
    carries the thought signature Gemini returned with it. Signed calls are sent
    back with their ``extra_content`` unchanged. Calls without one (commands FRIDAY
    ran directly, or history from another model) are sent as plain text instead,
    so there is nothing to validate. ``flatten_all`` does that for every call.
    """
    out: list[dict[str, Any]] = []
    if system:
        out.append({"role": "system", "content": system})
    flattened: dict[str, str] = {}  # tool_call_id -> tool name
    for m in messages:
        role = m["role"]
        if role == "assistant" and m.get("tool_calls"):
            calls = m["tool_calls"]
            signed = any(tc.get("extra") for tc in calls)
            if gemini and (flatten_all or not signed):
                lines = [m["content"]] if m.get("content") else []
                for tc in calls:
                    flattened[tc["id"]] = tc["name"]
                    lines.append(f"[I used the {tc['name']} tool with {_note_args(tc.get('args') or {})}]")
                out.append({"role": "assistant", "content": "\n".join(lines)})
                continue
            msg_calls = []
            for tc in calls:
                call: dict[str, Any] = {
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": json.dumps(tc["args"], ensure_ascii=False)},
                }
                if gemini and tc.get("extra"):
                    call["extra_content"] = tc["extra"]
                msg_calls.append(call)
            out.append({"role": "assistant", "content": m.get("content") or None, "tool_calls": msg_calls})
        elif role == "tool":
            if m["tool_call_id"] in flattened:
                name = flattened[m["tool_call_id"]]
                out.append({"role": "user", "content": f"[Result of {name}: {m['content']}]"})
            else:
                out.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"]})
        else:
            out.append({"role": role, "content": m.get("content", "")})
    if gemini:
        # Flattening can leave two plain messages of the same role in a row; join them.
        merged: list[dict[str, Any]] = []
        for msg in out:
            prev = merged[-1] if merged else None
            if (
                prev
                and prev["role"] == msg["role"]
                and msg["role"] in ("user", "assistant")
                and not prev.get("tool_calls")
                and not msg.get("tool_calls")
            ):
                prev["content"] = f"{prev.get('content') or ''}\n{msg.get('content') or ''}".strip()
            else:
                merged.append(dict(msg))
        out = merged
    return out


# Providers retire models often. When the saved model disappears, pick the
# first available match from this list (best chat + tool-calling first).
PREFERRED_MODELS: dict[str, list[str]] = {
    "groq": [
        "llama-3.3-70b", "gpt-oss-120b", "llama-4-maverick", "kimi-k2", "qwen3-32b",
        "llama-4-scout", "gpt-oss-20b", "llama-3.1-8b",
    ],
    "gemini": ["gemini-flash-lite-latest", "gemini-flash-latest", "flash-lite", "gemini-2.5-flash", "flash"],
    "openrouter": [":free"],
}
# Models that are not for chat.
NOT_CHAT = ("whisper", "tts", "guard", "embed", "orpheus", "playai", "distil", "compound", "vision", "audio", "image")


def parse_retry_after(header: str | None, body: str) -> float | None:
    """Seconds to wait, from the Retry-After header or text like 'try again in 1m2.5s'."""
    if header:
        try:
            return float(header)
        except ValueError:
            pass
    m = re.search(r"try again in (?:(\d+)m)?([\d.]+)(ms|s)", body)
    if not m:
        return None
    secs = float(m.group(2)) / (1000 if m.group(3) == "ms" else 1)
    return secs + 60 * int(m.group(1) or 0)


def suggest_model(provider: str, available: list[str]) -> str | None:
    chat = [m for m in available if not any(x in m.lower() for x in NOT_CHAT)]
    for pattern in PREFERRED_MODELS.get(provider, []):
        for m in chat:
            if pattern in m.lower():
                return m
    return chat[0] if chat else None


class OpenAICompatProvider(LLMProvider):
    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str = "",
        timeout_s: float = 120,
        max_tokens: int = 1024,
        label: str = "openai_compat",
    ) -> None:
        self.name = label
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout_s = timeout_s
        self.max_tokens = max_tokens
        self.gemini = label == "gemini" or "generativelanguage.googleapis.com" in base_url
        # Set after Gemini rejects a signature: send every past tool call as text.
        self.flatten_tools = False
        if label == "groq":
            # Groq's free tier allows only a few thousand tokens per minute per model.
            self.history_tokens = 1500
            self.tool_result_chars = 4000
            self.lean_tools = True

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        if self.name == "openrouter":
            h["X-Title"] = "FRIDAY"
        return h

    def describe(self) -> str:
        return f"{self.name}:{self.model}"

    async def check(self) -> dict[str, Any]:
        if not self.model:
            return {"ok": False, "detail": "No model name set."}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"{self.base_url}/models", headers=self._headers())
            if r.status_code == 401:
                return {"ok": False, "detail": "API key rejected (401). Check the key."}
            if r.status_code >= 400:
                return {"ok": False, "detail": f"HTTP {r.status_code} from {self.base_url}/models"}
            data = [m for m in r.json().get("data", []) if isinstance(m, dict) and m.get("active", True) is not False]
            ids = [str(m.get("id")) for m in data if m.get("id")]
            # Gemini lists ids as "models/gemini-..."; chat uses the bare name.
            ids = [i.removeprefix("models/") for i in ids]
            if ids and self.model not in ids:
                return {
                    "ok": False,
                    "detail": f"Model '{self.model}' is not available on {self.name}.",
                    "models": ids[:200],
                    "suggested": suggest_model(self.name, ids),
                }
            return {"ok": True, "detail": f"Connected to {self.name} with {self.model}.", "models": ids[:200]}
        except httpx.HTTPError as e:
            return {"ok": False, "detail": f"Cannot reach {self.base_url}: {e.__class__.__name__}"}

    async def stream(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None, *, system: str | None = None
    ) -> AsyncIterator[StreamEvent]:
        if not self.model:
            raise ProviderError("No model selected for this provider. Open Settings and pick a model.")
        body: dict[str, Any] = {
            "model": self.model,
            "messages": to_openai_messages(messages, system, gemini=self.gemini, flatten_all=self.flatten_tools),
            "stream": True,
            "max_tokens": self.max_tokens,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        pending: dict[int, dict[str, Any]] = {}
        finish = ""
        usage: dict[str, int] = {}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(self.timeout_s, connect=10)) as client:
                async with client.stream(
                    "POST", f"{self.base_url}/chat/completions", headers=self._headers(), json=body
                ) as resp:
                    if resp.status_code >= 400:
                        full = (await resp.aread()).decode("utf-8", "replace")
                        text = full[:400]
                        if resp.status_code == 400 and "thought_signature" in full:
                            raise SignatureRejected(
                                f"{self.name} ne purane tool calls ka signature maana nahi. 'Clear chat' dabakar dobara poochiye."
                            )
                        if resp.status_code == 413 or "request too large" in full.lower():
                            raise TooLarge(
                                f"{self.name} ki free limit ke hisaab se message bahut bada hai. 'Clear chat' dabakar "
                                "dobara poochiye, ya Settings me koi aur model chuniye."
                            )
                        if resp.status_code == 429:
                            raise RateLimited(
                                f"{self.name} ki free limit (ek minute me itne shabd) abhi poori ho gayi. "
                                "Thodi der baad dobara poochiye.",
                                parse_retry_after(resp.headers.get("retry-after"), full),
                            )
                        if resp.status_code == 401:
                            raise ProviderError("API key rejected by the provider (401).")
                        if resp.status_code == 404 or "model_not_found" in text:
                            raise ProviderError(
                                f"Model '{self.model}' {self.name} par ab available nahi hai. Settings kholo aur "
                                "Test connection dabao, FRIDAY sahi model khud chun lega."
                            )
                        if resp.status_code >= 500:
                            raise Unavailable(f"{self.name} abhi kaam nahi kar raha (error {resp.status_code}).")
                        raise ProviderError(f"Provider error {resp.status_code}: {text}")
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        if chunk.get("usage"):
                            u = chunk["usage"]
                            usage = {"input": u.get("prompt_tokens", 0), "output": u.get("completion_tokens", 0)}
                        for choice in chunk.get("choices", []):
                            delta = choice.get("delta") or {}
                            if delta.get("content"):
                                yield StreamEvent("text", text=delta["content"])
                            for tc in delta.get("tool_calls") or []:
                                idx = tc.get("index", 0)
                                slot = pending.setdefault(idx, {"id": "", "name": "", "args": "", "extra": None})
                                if tc.get("id"):
                                    slot["id"] = tc["id"]
                                if tc.get("extra_content"):
                                    slot["extra"] = {**(slot["extra"] or {}), **tc["extra_content"]}
                                fn = tc.get("function") or {}
                                if fn.get("name"):
                                    slot["name"] += fn["name"]
                                if fn.get("arguments"):
                                    slot["args"] += fn["arguments"]
                            if choice.get("finish_reason"):
                                finish = choice["finish_reason"]
        except httpx.HTTPError as e:
            raise Unavailable(f"Network problem talking to {self.name}: {e.__class__.__name__}") from e

        for idx in sorted(pending):
            slot = pending[idx]
            try:
                args = json.loads(slot["args"]) if slot["args"].strip() else {}
            except json.JSONDecodeError:
                yield StreamEvent("error", error=f"model produced invalid JSON for tool {slot['name']}")
                continue
            yield StreamEvent(
                "tool_call",
                tool_call=ToolCall(id=slot["id"] or f"call_{idx}", name=slot["name"], args=args, extra=slot["extra"]),
            )
        yield StreamEvent("done", finish_reason=finish or "stop", usage=usage)
