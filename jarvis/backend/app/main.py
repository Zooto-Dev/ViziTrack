"""FastAPI application: REST for settings/health, one WebSocket per UI.

WebSocket protocol (JSON, both directions)
  client -> server
    {type:"chat", text}                 send a user message
    {type:"stop"}                       interrupt the current reply
    {type:"confirm", request_id, approved}
    {type:"settings.set", patch}
    {type:"history.clear"}
    {type:"ping"}
  server -> client
    hello, monitor, state, assistant.start/.delta/.end, tool.start/.end,
    confirm.request, settings, history, provider.status, error, pong
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .brain.agent import Agent
from .brain.providers import build_provider
from .brain.router import route
from .config import PROVIDER_PRESETS, Settings, load_settings, public_settings, update_settings
from .memory.store import MemoryStore
from .monitor import SystemMonitor
from . import voice_tts
from .tools import builtin  # noqa: F401  (registers tools)
from .tools import files  # noqa: F401  (registers file tools)
from .tools.registry import registry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("jarvis")

FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


class Hub:
    """Tracks connected sessions and broadcasts monitor snapshots."""

    def __init__(self) -> None:
        self.sessions: set[Session] = set()

    async def broadcast(self, msg: dict[str, Any]) -> None:
        dead = []
        for s in list(self.sessions):
            try:
                await s.send(msg)
            except Exception:  # noqa: BLE001
                dead.append(s)
        for s in dead:
            self.sessions.discard(s)


class Session:
    def __init__(self, ws: WebSocket, agent: Agent, store: MemoryStore) -> None:
        self.ws = ws
        self.agent = agent
        self.store = store
        self.conv_id = store.latest_conversation_id() or uuid.uuid4().hex[:12]
        self.history: list[dict[str, Any]] = store.load_conversation(self.conv_id)
        self.cancel = asyncio.Event()
        self.task: asyncio.Task[None] | None = None
        self.pending_confirms: dict[str, asyncio.Future[bool]] = {}
        self.state = "idle"
        self.closed = False
        self._send_lock = asyncio.Lock()

    async def send(self, msg: dict[str, Any]) -> None:
        if self.closed:
            return
        async with self._send_lock:
            try:
                await self.ws.send_text(json.dumps(msg, ensure_ascii=False, default=str))
            except Exception:  # noqa: BLE001 - client went away mid-reply
                self.closed = True

    async def emit(self, msg: dict[str, Any]) -> None:
        if msg.get("type") == "state":
            self.state = msg["value"]
        await self.send(msg)

    async def confirm(self, request_id: str, tool: str, args: dict[str, Any], reason: str) -> bool:
        fut: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
        self.pending_confirms[request_id] = fut
        await self.emit({"type": "confirm.request", "request_id": request_id, "tool": tool, "args": args, "reason": reason})
        await self.emit({"type": "state", "value": "waiting"})
        try:
            return await asyncio.wait_for(fut, timeout=120)
        except asyncio.TimeoutError:
            return False
        finally:
            self.pending_confirms.pop(request_id, None)

    def ui_history(self) -> list[dict[str, Any]]:
        """History as the UI shows it: user/assistant text plus tool chips."""
        out = []
        for m in self.history:
            if m["role"] == "user":
                out.append({"role": "user", "text": m["content"]})
            elif m["role"] == "assistant" and m.get("content") and not m.get("tool_calls"):
                out.append({"role": "assistant", "text": m["content"]})
            elif m["role"] == "tool":
                content = str(m["content"])
                out.append({"role": "tool", "name": m.get("name", ""), "text": content[:300], "ok": not content.startswith("FAILED:")})
        return out[-80:]

    async def handle_chat(self, text: str) -> None:
        match = route(text)
        if match and match.intent == "stop":
            await self.stop()
            await self.emit({"type": "stopped"})
            return
        if self.task and not self.task.done():
            # A new message while replying = interrupt, then answer the new one.
            await self.stop()
        self.cancel = asyncio.Event()
        self.task = asyncio.create_task(self._run(text))

    async def _run(self, text: str) -> None:
        try:
            entries = await self.agent.handle(text, self.history, self.emit, self.confirm, self.cancel)
            self.history.extend(entries)
            await asyncio.to_thread(self.store.save_conversation, self.conv_id, self.history[-200:])
        except Exception as e:  # noqa: BLE001
            log.exception("chat failed")
            await self.emit({"type": "error", "message": f"Internal error: {type(e).__name__}: {e}"})
        finally:
            await self.emit({"type": "state", "value": "idle"})

    async def stop(self) -> None:
        self.cancel.set()
        for fut in self.pending_confirms.values():
            if not fut.done():
                fut.set_result(False)
        if self.task and not self.task.done():
            try:
                await asyncio.wait_for(self.task, timeout=2)
            except (asyncio.TimeoutError, Exception):  # noqa: BLE001
                self.task.cancel()
        await self.emit({"type": "state", "value": "idle"})

    async def clear_history(self) -> None:
        self.history = []
        self.conv_id = uuid.uuid4().hex[:12]
        await asyncio.to_thread(self.store.save_conversation, self.conv_id, [])
        await self.emit({"type": "history", "messages": []})


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = MemoryStore()
    builtin.set_store(store)
    hub = Hub()
    monitor = SystemMonitor(hub.broadcast)
    app.state.store = store
    app.state.hub = hub
    app.state.monitor = monitor
    app.state.agent = Agent(registry, store)
    app.state.warm = {"state": "idle"}
    monitor.start()
    schedule_warmup()
    log.info("FRIDAY backend %s ready. %d tools registered.", __version__, len(registry.all()))
    try:
        yield
    finally:
        task = getattr(app.state, "warm_task", None)
        if task and not task.done():
            task.cancel()
        await monitor.stop()
        store.close()


app = FastAPI(title="F.R.I.D.A.Y.", version=__version__, lifespan=lifespan)


async def _warmup() -> None:
    """Load the local model and cache the prompt so the first message is fast."""
    s = load_settings()
    if s.provider.name != "ollama":
        app.state.warm = {"state": "idle"}
        return
    provider = build_provider(s)
    hub: Hub = app.state.hub
    app.state.warm = {"state": "loading", "model": s.provider.model}
    await hub.broadcast({"type": "provider.warm", **app.state.warm})
    t0 = time.perf_counter()
    system, tools = await app.state.agent.context(s, provider)
    ok = await provider.warmup(system, tools)  # type: ignore[attr-defined]
    ms = int((time.perf_counter() - t0) * 1000)
    app.state.warm = {"state": "ready" if ok else "failed", "model": s.provider.model, "ms": ms}
    log.info("model warmup %s in %d ms", app.state.warm["state"], ms)
    await hub.broadcast({"type": "provider.warm", **app.state.warm})


def schedule_warmup() -> None:
    prev = getattr(app.state, "warm_task", None)
    if prev and not prev.done():
        prev.cancel()
    app.state.warm_task = asyncio.create_task(_warmup())


# ---------------------------------------------------------------- REST ----
@app.get("/api/health")
async def health() -> dict[str, Any]:
    s = load_settings()
    return {"ok": True, "version": __version__, "provider": s.provider.name, "model": s.provider.model, "tools": len(registry.all())}


@app.get("/api/settings")
async def get_settings() -> dict[str, Any]:
    return public_settings()


class SettingsPatch(BaseModel):
    patch: dict[str, Any]


@app.post("/api/settings")
async def post_settings(body: SettingsPatch) -> dict[str, Any]:
    # Masked key coming back from the UI must not overwrite the real one.
    prov = body.patch.get("provider", {})
    if isinstance(prov, dict) and isinstance(prov.get("api_key"), str) and prov["api_key"].startswith("•"):
        prov.pop("api_key")
    s = update_settings(body.patch)
    await app.state.hub.broadcast({"type": "settings", "settings": public_settings(s)})
    if "provider" in body.patch:
        schedule_warmup()
    return public_settings(s)


@app.get("/api/providers/test")
async def test_provider() -> dict[str, Any]:
    s = load_settings()
    try:
        provider = build_provider(s)
        result = await provider.check()
        suggested = result.get("suggested")
        if not result.get("ok") and suggested and suggested != s.provider.model:
            # The saved model was retired: switch to a working one and say so.
            old_model = s.provider.model
            s = update_settings({"provider": {"model": suggested}})
            await app.state.hub.broadcast({"type": "settings", "settings": public_settings(s)})
            result = await build_provider(s).check()
            if result.get("ok"):
                result["detail"] = f"'{old_model}' ab available nahi tha, isliye model badal kar '{suggested}' kar diya. Ready."
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "detail": f"{type(e).__name__}: {e}"}
    result.update({"provider": s.provider.name, "model": s.provider.model})
    return result


@app.get("/api/tts")
async def tts(text: str, voice: str = "") -> Response:
    """One sentence of FRIDAY's reply as MP3, in a neural voice."""
    s = load_settings()
    try:
        audio = await voice_tts.synthesize(text, voice or s.voice.neural_voice, s.voice.tts_rate)
    except voice_tts.TTSUnavailable as e:
        log.warning("neural voice unavailable: %s", e)
        return JSONResponse({"error": str(e)}, status_code=503)
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/voices")
async def voices() -> list[dict[str, str]]:
    return [{"id": v, "label": label} for v, label in voice_tts.NEURAL_VOICES]


@app.get("/api/tasks")
async def tasks(status: str = "pending") -> list[dict[str, Any]]:
    return await asyncio.to_thread(app.state.store.list_tasks, status if status in ("pending", "done", "all") else "pending")


@app.get("/api/tools")
async def list_tools() -> list[dict[str, Any]]:
    return registry.public_list()


@app.get("/api/monitor")
async def monitor_now() -> dict[str, Any]:
    return await asyncio.to_thread(app.state.monitor.sample)


# ----------------------------------------------------------- WebSocket ----
@app.websocket("/ws")
async def websocket(ws: WebSocket) -> None:
    await ws.accept()
    hub: Hub = app.state.hub
    monitor: SystemMonitor = app.state.monitor
    session = Session(ws, app.state.agent, app.state.store)
    monitor.subscribers += 1
    try:
        await session.send(
            {
                "type": "hello",
                "version": __version__,
                "settings": public_settings(),
                "tools": registry.public_list(),
                "history": session.ui_history(),
                "monitor": monitor.last_snapshot or await asyncio.to_thread(monitor.sample),
                "warm": app.state.warm,
            }
        )
        hub.sessions.add(session)
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await session.send({"type": "error", "message": "bad JSON"})
                continue
            t = msg.get("type")
            if t == "chat":
                text = str(msg.get("text", "")).strip()
                if text:
                    await session.handle_chat(text)
            elif t == "stop":
                await session.stop()
            elif t == "confirm":
                fut = session.pending_confirms.get(str(msg.get("request_id")))
                if fut and not fut.done():
                    fut.set_result(bool(msg.get("approved")))
            elif t == "settings.set":
                patch = msg.get("patch") or {}
                prov = patch.get("provider", {})
                if isinstance(prov, dict) and str(prov.get("api_key", "")).startswith("•"):
                    prov.pop("api_key")
                s = update_settings(patch)
                await hub.broadcast({"type": "settings", "settings": public_settings(s)})
                if "provider" in patch:
                    schedule_warmup()
            elif t == "history.clear":
                await session.clear_history()
            elif t == "ping":
                await session.send({"type": "pong", "state": session.state})
    except WebSocketDisconnect:
        pass
    finally:
        session.closed = True
        hub.sessions.discard(session)
        monitor.subscribers -= 1
        if session.task and not session.task.done():
            session.cancel.set()


# ------------------------------------------------------- static frontend ----
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):  # noqa: ANN201
        target = FRONTEND_DIST / path
        if path and target.is_file():
            return FileResponse(target)
        return FileResponse(FRONTEND_DIST / "index.html")
else:

    @app.get("/", include_in_schema=False)
    async def no_frontend() -> JSONResponse:
        return JSONResponse(
            {"message": "Frontend not built. Run `pnpm build` in jarvis/frontend, or use the Vite dev server."}
        )


def preset_for(name: str) -> dict[str, Any]:
    return PROVIDER_PRESETS.get(name, {})


__all__ = ["app", "Settings", "preset_for"]
