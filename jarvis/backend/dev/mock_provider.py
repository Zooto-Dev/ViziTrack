"""A tiny fake LLM server for development and tests (no real model needed).

Speaks both the OpenAI chat-completions protocol (``/v1/chat/completions``)
and Ollama's (``/api/chat``, ``/api/tags``).  Behaviour is deliberately
simple and deterministic:

* If the latest user message contains "time", it calls the ``get_time`` tool,
  then on the follow-up turn answers with the tool result.
* If it contains "remember", it calls ``remember`` with the rest of the text.
* Otherwise it streams a short canned reply that echoes the question.

Run standalone:  python -m dev.mock_provider   (port 11434 by default)
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI(title="mock-llm")

MODEL = "mock-model"
# Recorded request bodies, for tests.
WARMUPS: list[dict[str, Any]] = []
CHATS: list[dict[str, Any]] = []
OPENAI_CHATS: list[dict[str, Any]] = []
# Free-tier simulation for tests: reject requests bigger than this many characters,
# and answer the next N requests with a per-minute rate limit.
LIMITS: dict[str, int] = {"max_chars": 0, "rate_limit_next": 0, "reject_signatures_next": 0}
# Gemini emulation (model "gemini-mock"): thought signatures handed out with tool calls.
GEMINI_MODEL = "gemini-mock"
SIGNATURES: set[str] = set()


def gemini_signature_error(messages: list[dict[str, Any]]) -> str | None:
    """Like Gemini: every function call in the history needs its thought signature back."""
    for pos, m in enumerate(messages):
        calls = m.get("tool_calls") or []
        if calls:
            sig = ((calls[0].get("extra_content") or {}).get("google") or {}).get("thought_signature")
            if sig not in SIGNATURES:
                return (
                    "Function call is missing a thought_signature in functionCall parts. Additional data, "
                    f"function call `default_api:{calls[0]['function']['name']}` , position {pos}."
                )
    return None


def _last_user(messages: list[dict[str, Any]]) -> str:
    for m in reversed(messages):
        if m.get("role") == "user" and isinstance(m.get("content"), str):
            return m["content"]
    return ""


def _last_tool_result(messages: list[dict[str, Any]]) -> str | None:
    if messages and messages[-1].get("role") == "tool":
        return str(messages[-1].get("content"))
    # Tool results sent as text (Gemini fallback) end with a "[Result of ...]" user message.
    last = str(messages[-1].get("content") or "") if messages else ""
    if messages and messages[-1].get("role") == "user" and "[Result of " in last:
        return last[last.rindex("[Result of ") :].split(": ", 1)[-1].rstrip("]")
    return None


def decide(messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Return {"text": ...} or {"tool": name, "args": {...}}."""
    tool_result = _last_tool_result(messages)
    if tool_result is not None:
        return {"text": f"Done. Result: {tool_result}"}
    user = _last_user(messages)
    low = user.lower()
    names = {t.get("function", {}).get("name") or t.get("name") for t in tools or []}
    if "time" in low and "get_time" in names:
        return {"tool": "get_time", "args": {}}
    if ("remember" in low or "memory" in low) and "remember" in names:
        text = user.split(":", 1)[1].strip() if ":" in user else user
        return {"tool": "remember", "args": {"text": text}}
    if "write code" in low and "write_file" in names:
        return {"tool": "write_file", "args": {"filename": "hello.py", "content": "print('hello')\n", "open_after": False}}
    if "fail" in low and "open_app" in names:
        return {"tool": "open_app", "args": {"name": "definitely-not-an-app-xyz"}}
    if "aaj ka plan" in low:  # demo line for screenshots
        return {"text": "Aaj aapke teen kaam pending hain: GST return, Rahul ka invoice, aur Monday ki PPT. GST ki deadline sabse paas hai, wahi pehle karein?"}
    if "show code" in low:
        return {"text": "Here is the script.\n```python\nfor i in range(3):\n    print(i)\n```\nRun it with Python."}
    if "slow" in low:
        return {"text": f"Mock reply to: {user}. Second sentence here!", "delay": 3.0}
    return {"text": f"Mock reply to: {user}"}


def _words(text: str) -> list[str]:
    parts = text.split(" ")
    return [p + (" " if i < len(parts) - 1 else "") for i, p in enumerate(parts)]


# ----------------------------------------------------------- OpenAI style --
async def _openai_stream(decision: dict[str, Any], gemini: bool = False) -> AsyncIterator[bytes]:
    await asyncio.sleep(decision.get("delay", 0))
    cid = "chatcmpl-" + uuid.uuid4().hex[:8]
    base = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()), "model": MODEL}
    if "tool" in decision:
        call_id = "call_" + uuid.uuid4().hex[:8]
        first: dict[str, Any] = {"index": 0, "id": call_id, "type": "function", "function": {"name": decision["tool"], "arguments": ""}}
        if gemini:
            sig = "sig-" + uuid.uuid4().hex[:12]
            SIGNATURES.add(sig)
            first["extra_content"] = {"google": {"thought_signature": sig}}
        yield f"data: {json.dumps({**base, 'choices': [{'index': 0, 'delta': {'role': 'assistant', 'tool_calls': [first]}, 'finish_reason': None}]})}\n\n".encode()
        args = json.dumps(decision["args"])
        for i in range(0, len(args), 6):
            yield f"data: {json.dumps({**base, 'choices': [{'index': 0, 'delta': {'tool_calls': [{'index': 0, 'function': {'arguments': args[i:i + 6]}}]}, 'finish_reason': None}]})}\n\n".encode()
        yield f"data: {json.dumps({**base, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls'}]})}\n\n".encode()
    else:
        for w in _words(decision["text"]):
            yield f"data: {json.dumps({**base, 'choices': [{'index': 0, 'delta': {'content': w}, 'finish_reason': None}]})}\n\n".encode()
            await asyncio.sleep(0.01)
        yield f"data: {json.dumps({**base, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 42, 'completion_tokens': 7}})}\n\n".encode()
    yield b"data: [DONE]\n\n"


@app.get("/v1/models")
async def models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {"id": "whisper-large-v3", "object": "model", "active": True},
            {"id": "old-retired-model", "object": "model", "active": False},
            {"id": MODEL, "object": "model", "active": True},
            {"id": GEMINI_MODEL, "object": "model", "active": True},
        ],
    }


@app.post("/v1/chat/completions", response_model=None)
async def chat_completions(req: Request) -> StreamingResponse | JSONResponse:
    body = await req.json()
    if req.headers.get("authorization", "") == "Bearer bad-key":
        return JSONResponse({"error": {"message": "invalid api key"}}, status_code=401)
    gemini = str(body.get("model", "")).startswith("gemini")
    if body.get("model") != MODEL and not gemini:
        return JSONResponse(
            {"error": {"message": f"The model `{body.get('model')}` does not exist", "code": "model_not_found"}},
            status_code=404,
        )
    OPENAI_CHATS.append(body)
    if gemini:
        err = gemini_signature_error(body.get("messages", []))
        if LIMITS["reject_signatures_next"] > 0 and any(m.get("tool_calls") for m in body.get("messages", [])):
            LIMITS["reject_signatures_next"] -= 1
            err = err or "Function call is missing a thought_signature in functionCall parts."
        if err:
            return JSONResponse([{"error": {"code": 400, "message": err, "status": "INVALID_ARGUMENT"}}], status_code=400)
    if LIMITS["rate_limit_next"] > 0:
        LIMITS["rate_limit_next"] -= 1
        return JSONResponse(
            {"error": {"message": "Rate limit reached on tokens per minute (TPM). Please try again in 0.3s.", "code": "rate_limit_exceeded"}},
            status_code=429,
        )
    if LIMITS["max_chars"] and len(json.dumps(body["messages"])) > LIMITS["max_chars"]:
        return JSONResponse(
            {"error": {"message": "Request too large for model on tokens per minute (TPM): Limit 8000, Requested 8465", "code": "rate_limit_exceeded"}},
            status_code=413,
        )
    decision = decide(body.get("messages", []), body.get("tools"))
    if not body.get("stream"):
        return JSONResponse({"choices": [{"message": {"role": "assistant", "content": decision.get("text", "")}}]})
    return StreamingResponse(_openai_stream(decision, gemini), media_type="text/event-stream")


# ----------------------------------------------------------- Ollama style --
async def _ollama_stream(decision: dict[str, Any]) -> AsyncIterator[bytes]:
    await asyncio.sleep(decision.get("delay", 0))
    if "tool" in decision:
        msg = {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": decision["tool"], "arguments": decision["args"]}}]}
        yield (json.dumps({"model": MODEL, "message": msg, "done": False}) + "\n").encode()
    else:
        for w in _words(decision["text"]):
            yield (json.dumps({"model": MODEL, "message": {"role": "assistant", "content": w}, "done": False}) + "\n").encode()
            await asyncio.sleep(0.01)
    yield (json.dumps({"model": MODEL, "message": {"role": "assistant", "content": ""}, "done": True, "prompt_eval_count": 42, "eval_count": 7}) + "\n").encode()


@app.get("/api/tags")
async def tags() -> dict[str, Any]:
    return {"models": [{"name": MODEL, "model": MODEL}]}


@app.post("/api/chat", response_model=None)
async def ollama_chat(req: Request) -> StreamingResponse | JSONResponse:
    body = await req.json()
    if body.get("model") != MODEL:
        return JSONResponse({"error": f"model '{body.get('model')}' not found"}, status_code=404)
    decision = decide(body.get("messages", []), body.get("tools"))
    if body.get("stream") is False:
        WARMUPS.append(body)
        return JSONResponse({"model": MODEL, "message": {"role": "assistant", "content": "ok"}, "done": True})
    CHATS.append(body)
    return StreamingResponse(_ollama_stream(decision), media_type="application/x-ndjson")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("MOCK_PORT", "11434")), log_level="warning")
