"""End-to-end over the real WebSocket with the in-process mock LLM."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app import config


def _collect(ws, until_type: str, limit: int = 200) -> list[dict]:
    out = []
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        if msg["type"] == "monitor" or (msg["type"] == "provider.warm" and until_type != "provider.warm"):
            continue
        out.append(msg)
        if msg["type"] == until_type:
            return out
    raise AssertionError(f"never saw {until_type}; got {[m['type'] for m in out]}")


@pytest.fixture()
def client(mock_llm, monkeypatch):
    # Reset settings to the mock Ollama provider.
    config._settings = None
    config.update_settings({"provider": {"name": "ollama", "base_url": "http://mock", "model": "mock-model"}})
    from app.main import app

    with TestClient(app) as c:
        yield c


def test_hello_and_direct_command(client):
    with client.websocket_connect("/ws") as ws:
        hello = json.loads(ws.receive_text())
        assert hello["type"] == "hello"
        assert any(t["name"] == "open_app" for t in hello["tools"])
        assert hello["settings"]["provider"]["name"] == "ollama"
        assert "api_key" in hello["settings"]["provider"] and hello["settings"]["provider"]["has_key"] is False

        ws.send_text(json.dumps({"type": "chat", "text": "time kya hua"}))
        msgs = _collect(ws, "assistant.end")
        types = [m["type"] for m in msgs]
        assert "tool.start" in types and "tool.end" in types
        end = msgs[-1]
        assert end["via"] == "direct" and "hai" in end["text"]  # Hinglish reply
        _collect(ws, "state")  # back to idle


def test_llm_streaming_and_tool_round_trip(client):
    with client.websocket_connect("/ws") as ws:
        json.loads(ws.receive_text())
        ws.send_text(json.dumps({"type": "chat", "text": "Could you check the clock time for me, in words"}))
        msgs = _collect(ws, "assistant.end")
        types = [m["type"] for m in msgs]
        # Router does not match this phrasing -> LLM -> get_time tool -> final text.
        assert types[0] == "state" and msgs[0]["value"] == "thinking"
        assert "tool.start" in types and "tool.end" in types
        tool_end = next(m for m in msgs if m["type"] == "tool.end")
        assert tool_end["ok"] is True and tool_end["name"] == "get_time"
        deltas = "".join(m["text"] for m in msgs if m["type"] == "assistant.delta")
        assert deltas.startswith("Done. Result:")
        assert msgs[-1]["text"] == deltas


def test_llm_plain_reply_and_history_persists(client):
    with client.websocket_connect("/ws") as ws:
        json.loads(ws.receive_text())
        ws.send_text(json.dumps({"type": "chat", "text": "tell me a joke"}))
        msgs = _collect(ws, "assistant.end")
        assert msgs[-1]["text"] == "Mock reply to: tell me a joke"
        assert msgs[-1]["via"].startswith("ollama:")
    with client.websocket_connect("/ws") as ws:
        hello = json.loads(ws.receive_text())
        texts = [m["text"] for m in hello["history"]]
        assert "tell me a joke" in texts and "Mock reply to: tell me a joke" in texts


def test_tool_failure_is_reported_not_faked(client):
    with client.websocket_connect("/ws") as ws:
        json.loads(ws.receive_text())
        ws.send_text(json.dumps({"type": "chat", "text": "please fail by opening an app"}))
        msgs = _collect(ws, "assistant.end")
        tool_end = next(m for m in msgs if m["type"] == "tool.end")
        assert tool_end["ok"] is False
        assert "FAILED" in msgs[-1]["text"]


def test_confirm_gate_declined(client):
    with client.websocket_connect("/ws") as ws:
        json.loads(ws.receive_text())
        ws.send_text(json.dumps({"type": "settings.set", "patch": {"confirm_all_system_actions": True}}))
        s = json.loads(ws.receive_text())
        assert s["type"] == "settings" and s["settings"]["confirm_all_system_actions"] is True
        ws.send_text(json.dumps({"type": "chat", "text": "open chrome"}))
        req = _collect(ws, "confirm.request")[-1]
        assert req["tool"] == "open_app"
        ws.send_text(json.dumps({"type": "confirm", "request_id": req["request_id"], "approved": False}))
        msgs = _collect(ws, "assistant.end")
        tool_end = next(m for m in msgs if m["type"] == "tool.end")
        assert tool_end["ok"] is False and "declined" in tool_end["result"]
        ws.send_text(json.dumps({"type": "settings.set", "patch": {"confirm_all_system_actions": False}}))


def test_provider_error_when_model_missing(client):
    client.post("/api/settings", json={"patch": {"provider": {"model": "nope-model"}}})
    with client.websocket_connect("/ws") as ws:
        json.loads(ws.receive_text())
        ws.send_text(json.dumps({"type": "chat", "text": "hello there friend"}))
        msgs = _collect(ws, "error")
        assert "ollama pull nope-model" in msgs[-1]["message"]
    client.post("/api/settings", json={"patch": {"provider": {"model": "mock-model"}}})


def test_rest_endpoints(client):
    assert client.get("/api/health").json()["ok"] is True
    r = client.get("/api/providers/test").json()
    assert r["ok"] is True and "mock-model" in r["models"]
    m = client.get("/api/monitor").json()
    assert m["type"] == "monitor" and 0 <= m["cpu"] <= 100 and m["ram"]["total_gb"] > 0
    # Masked key must never overwrite the real one.
    client.post("/api/settings", json={"patch": {"provider": {"api_key": "real-secret-key"}}})
    client.post("/api/settings", json={"patch": {"provider": {"api_key": "••••••••-key"}}})
    assert config.load_settings().provider.api_key == "real-secret-key"
    pub = client.get("/api/settings").json()
    assert "real-secret" not in json.dumps(pub)
    client.post("/api/settings", json={"patch": {"provider": {"api_key": ""}}})


def test_openai_compat_provider_streams(client):
    client.post("/api/settings", json={"patch": {"provider": {"name": "groq", "base_url": "http://mock/v1", "model": "mock-model", "api_key": "k"}}})
    with client.websocket_connect("/ws") as ws:
        json.loads(ws.receive_text())
        ws.send_text(json.dumps({"type": "chat", "text": "Please make a note in memory: pizza night is Friday"}))
        msgs = _collect(ws, "assistant.end")
        tool_end = next(m for m in msgs if m["type"] == "tool.end")
        assert tool_end["name"] == "remember" and tool_end["ok"]
        assert msgs[-1]["via"] == "groq:mock-model"
    client.post("/api/settings", json={"patch": {"provider": {"api_key": "bad-key"}}})
    with client.websocket_connect("/ws") as ws:
        json.loads(ws.receive_text())
        ws.send_text(json.dumps({"type": "chat", "text": "hello again"}))
        msgs = _collect(ws, "error")
        assert "401" in msgs[-1]["message"]
    client.post("/api/settings", json={"patch": {"provider": {"name": "ollama", "base_url": "http://mock", "model": "mock-model", "api_key": ""}}})


def test_stop_command_interrupts_without_llm(client):
    with client.websocket_connect("/ws") as ws:
        json.loads(ws.receive_text())
        ws.send_text(json.dumps({"type": "chat", "text": "ruko"}))
        msgs = _collect(ws, "stopped")
        assert not any(m["type"].startswith("assistant") for m in msgs)


def test_warmup_caches_the_same_prefix_as_chat(client):
    from dev import mock_provider

    mock_provider.WARMUPS.clear()
    mock_provider.CHATS.clear()
    with client.websocket_connect("/ws") as ws:
        json.loads(ws.receive_text())
        # Changing the provider schedules a warmup, reported loading -> ready.
        ws.send_text(json.dumps({"type": "settings.set", "patch": {"provider": {"name": "ollama", "base_url": "http://mock", "model": "mock-model"}}}))
        states = []
        while "ready" not in states and "failed" not in states:
            states.append(_collect(ws, "provider.warm")[-1]["state"])
        assert states[-1] == "ready"
        ws.send_text(json.dumps({"type": "chat", "text": "tell me about stars"}))
        _collect(ws, "assistant.end")
    w, c = mock_provider.WARMUPS[-1], mock_provider.CHATS[-1]
    # Same system prompt, tools and context size: Ollama can reuse its cache.
    assert w["messages"][0] == c["messages"][0] and w["messages"][0]["role"] == "system"
    assert w["tools"] == c["tools"]
    assert w["options"]["num_ctx"] == c["options"]["num_ctx"]
    assert w["keep_alive"] == c["keep_alive"]
