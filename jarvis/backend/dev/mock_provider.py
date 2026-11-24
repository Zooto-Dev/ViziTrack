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


def _last_user(messages: list[dict[str, Any]]) -> str:
    for m in reversed(messages):
        if m.get("role") == "user" and isinstance(m.get("content"), str):
            return m["content"]
    return ""


def _last_tool_result(messages: list[dict[str, Any]]) -> str | None:
    if messages and messages[-1].get("role") == "tool":
        return str(messages[-1].get("content"))
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
    if "fail" in low and "open_app" in names:
        return {"tool": "open_app", "args": {"name": "definitely-not-an-app-xyz"}}
    return {"text": f"Mock reply to: {user}"}


def _words(text: str) -> list[str]:
    parts = text.split(" ")
    return [p + (" " if i < len(parts) - 1 else "") for i, p in enumerate(parts)]


# ----------------------------------------------------------- OpenAI style --
async def _openai_stream(decision: dict[str, Any]) -> AsyncIterator[bytes]:
    cid = "chatcmpl-" + uuid.uuid4().hex[:8]
    base = {"id": cid, "object": "chat.completion.chunk", "created": int(time.time()), "model": MODEL}
    if "tool" in decision:
        call_id = "call_" + uuid.uuid4().hex[:8]
        yield f"data: {json.dumps({**base, 'choices': [{'index': 0, 'delta': {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': call_id, 'type': 'function', 'function': {'name': decision['tool'], 'arguments': ''}}]}, 'finish_reason': None}]})}\n\n".encode()
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
    return {"object": "list", "data": [{"id": MODEL, "object": "model"}]}


@app.post("/v1/chat/completions", response_model=None)
async def chat_completions(req: Request) -> StreamingResponse | JSONResponse:
    body = await req.json()
    if req.headers.get("authorization", "") == "Bearer bad-key":
        return JSONResponse({"error": {"message": "invalid api key"}}, status_code=401)
    decision = decide(body.get("messages", []), body.get("tools"))
    if not body.get("stream"):
        return JSONResponse({"choices": [{"message": {"role": "assistant", "content": decision.get("text", "")}}]})
    return StreamingResponse(_openai_stream(decision), media_type="text/event-stream")


# ----------------------------------------------------------- Ollama style --
async def _ollama_stream(decision: dict[str, Any]) -> AsyncIterator[bytes]:
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
    return StreamingResponse(_ollama_stream(decision), media_type="application/x-ndjson")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("MOCK_PORT", "11434")), log_level="warning")
