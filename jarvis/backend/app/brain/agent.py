"""The agent loop: route -> (tool | LLM with tools) -> stream reply.

Emits neutral events the session forwards to the UI:
    state, assistant.start/.delta/.end, tool.start/.end, confirm.request, error
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Awaitable, Callable

from ..config import Settings, load_settings
from ..memory.store import MemoryStore
from ..tools.registry import ToolRegistry, ToolResult
from .prompts import build_system_prompt
from .providers import build_provider
from .context import cap_tool_result, fit_history, select_tools
from .providers.base import ProviderError, RateLimited, StreamEvent, TooLarge
from .router import detect_language, phrase_result, route

log = logging.getLogger("jarvis.agent")

Emit = Callable[[dict[str, Any]], Awaitable[None]]
Confirm = Callable[[str, str, dict[str, Any], str], Awaitable[bool]]  # (request_id, tool, args, reason) -> approved

MAX_TOOL_ROUNDS = 6
MAX_WAIT_FOR_LIMIT_S = 30  # wait out a free-tier per-minute limit if it clears this soon


class Agent:
    def __init__(self, registry: ToolRegistry, store: MemoryStore) -> None:
        self.registry = registry
        self.store = store

    # ------------------------------------------------------------------
    async def context(
        self, settings: Settings, provider: Any, text: str = "", history: list[dict[str, Any]] | None = None
    ) -> tuple[str, list[dict[str, Any]]]:
        """System prompt + tool schemas. Warmup uses the same so the prefix cache matches."""
        memories = await asyncio.to_thread(self.store.recent_memories, 8)
        system = build_system_prompt(settings, memories)
        chosen = self.registry.all()
        if getattr(provider, "lean_tools", False) and text:
            chosen = select_tools(chosen, text, history or [])
        if provider.name == "anthropic":
            tools = [t.anthropic_schema() for t in chosen]
        else:
            tools = [t.openai_schema() for t in chosen]
        return system, tools

    # ------------------------------------------------------------------
    async def run_tool(self, name: str, args: dict[str, Any], emit: Emit, confirm: Confirm, settings: Settings) -> ToolResult:
        tool = self.registry.get(name)
        call_id = uuid.uuid4().hex[:8]
        if not tool:
            res = ToolResult(False, f"unknown tool '{name}'")
            await emit({"type": "tool.end", "id": call_id, "name": name, "ok": False, "result": res.message})
            return res
        reason = tool.description if tool.risk == "confirm" else None
        if reason is None and tool.confirm_if:
            try:
                reason = tool.confirm_if(args)
            except Exception:  # noqa: BLE001 - a broken check must fail safe
                reason = "Please confirm this action."
        if reason is None and settings.confirm_all_system_actions and tool.system_action:
            reason = tool.description
        if reason is not None:
            approved = await confirm(call_id, name, args, reason)
            if not approved:
                res = ToolResult(False, "the user declined this action")
                await emit({"type": "tool.end", "id": call_id, "name": name, "ok": False, "result": res.message})
                return res
        await emit({"type": "tool.start", "id": call_id, "name": name, "args": args})
        await emit({"type": "state", "value": "executing"})
        res = await self.registry.execute(name, args)
        await emit(
            {"type": "tool.end", "id": call_id, "name": name, "ok": res.ok, "result": res.message, "data": res.data, "ms": res.elapsed_ms}
        )
        return res

    # ------------------------------------------------------------------
    async def handle(
        self,
        text: str,
        history: list[dict[str, Any]],
        emit: Emit,
        confirm: Confirm,
        cancel: asyncio.Event,
    ) -> list[dict[str, Any]]:
        """Process one user utterance. Returns the new history entries to persist."""
        settings = load_settings()
        new_entries: list[dict[str, Any]] = [{"role": "user", "content": text}]
        msg_id = uuid.uuid4().hex[:10]

        # 1. Fast path: direct command, no LLM.
        match = route(text)
        if match and match.intent == "tool" and match.tool:
            res = await self.run_tool(match.tool, match.args, emit, confirm, settings)
            reply = phrase_result(match.tool, res.ok, res.message, res.data, match.lang, settings.user_name)
            await emit({"type": "assistant.start", "id": msg_id, "via": "direct"})
            await emit({"type": "assistant.delta", "id": msg_id, "text": reply})
            await emit({"type": "assistant.end", "id": msg_id, "text": reply, "via": "direct"})
            did = "direct_" + uuid.uuid4().hex[:8]
            new_entries.append({"role": "assistant", "content": "", "tool_calls": [{"id": did, "name": match.tool, "args": match.args}]})
            new_entries.append({"role": "tool", "tool_call_id": did, "name": match.tool, "content": res.to_llm()})
            new_entries.append({"role": "assistant", "content": reply})
            return new_entries

        # 2. LLM path.
        await emit({"type": "state", "value": "thinking"})
        try:
            provider = build_provider(settings)
        except Exception as e:  # noqa: BLE001
            await emit({"type": "error", "message": f"AI provider configuration problem: {e}"})
            return new_entries
        system, tools = await self.context(settings, provider, text, history)
        past = fit_history(history, provider.history_tokens, settings.history_limit)
        messages = [*past, *new_entries]

        full_text = ""
        started = False
        for _round in range(MAX_TOOL_ROUNDS):
            if cancel.is_set():
                break
            round_text = ""
            tool_calls = []
            finish = "stop"
            try:
                for attempt in range(3):
                    try:
                        async for ev in provider.stream(messages, tools, system=system):
                            if cancel.is_set():
                                break
                            if ev.type == "text":
                                if not started:
                                    started = True
                                    await emit({"type": "assistant.start", "id": msg_id, "via": provider.describe()})
                                round_text += ev.text
                                full_text += ev.text
                                await emit({"type": "assistant.delta", "id": msg_id, "text": ev.text})
                            elif ev.type == "tool_call" and ev.tool_call:
                                tool_calls.append(ev.tool_call)
                            elif ev.type == "error":
                                await emit({"type": "error", "message": ev.error})
                            elif ev.type == "done":
                                finish = ev.finish_reason
                        break
                    except TooLarge:
                        if attempt > 0 or round_text:
                            raise
                        # Too big for the free tier: drop earlier conversation and shorten results, then retry.
                        messages = [*new_entries]
                        for m in messages:
                            if m.get("role") == "tool":
                                m["content"] = cap_tool_result(str(m["content"]), 1500)
                        log.info("request too large; retrying with the current turn only")
                    except RateLimited as e:
                        wait = e.retry_after if e.retry_after is not None else 10.0
                        if attempt >= 2 or round_text or wait > MAX_WAIT_FOR_LIMIT_S:
                            raise
                        await emit(
                            {
                                "type": "notice",
                                "message": f"{provider.name} ki free limit: {wait:.0f} second ruk kar dobara koshish kar rahi hoon…",
                            }
                        )
                        try:
                            await asyncio.wait_for(cancel.wait(), timeout=wait + 0.5)
                        except asyncio.TimeoutError:
                            pass
                        if cancel.is_set():
                            break
            except ProviderError as e:
                await emit({"type": "error", "message": str(e)})
                if started:
                    await emit({"type": "assistant.end", "id": msg_id, "text": full_text, "via": provider.describe()})
                    new_entries.append({"role": "assistant", "content": full_text})
                return new_entries
            except Exception as e:  # noqa: BLE001
                log.exception("provider failure")
                await emit({"type": "error", "message": f"Unexpected provider failure: {type(e).__name__}: {e}"})
                return new_entries

            if cancel.is_set():
                break
            if not tool_calls:
                break

            assistant_entry = {
                "role": "assistant",
                "content": round_text,
                "tool_calls": [{"id": tc.id, "name": tc.name, "args": tc.args} for tc in tool_calls],
            }
            messages.append(assistant_entry)
            new_entries.append(assistant_entry)
            results = await asyncio.gather(*(self.run_tool(tc.name, tc.args, emit, confirm, settings) for tc in tool_calls))
            for tc, res in zip(tool_calls, results):
                content = cap_tool_result(res.to_llm(), provider.tool_result_chars)
                entry = {"role": "tool", "tool_call_id": tc.id, "name": tc.name, "content": content}
                messages.append(entry)
                new_entries.append(entry)
            await emit({"type": "state", "value": "thinking"})
            if finish == "length":
                break
        else:
            await emit({"type": "error", "message": "Stopped after too many tool steps."})

        if cancel.is_set() and not started:
            return new_entries
        if not started:
            # Model returned nothing at all: tell the user instead of showing an empty bubble.
            fallback = {
                "hindi": "माफ़ कीजिए, मुझे कोई उत्तर नहीं मिला। दोबारा कोशिश करें।",
                "hinglish": "Sorry, mujhe koi jawab nahi mila. Dobara try karein.",
                "english": "Sorry, I didn't get a response. Please try again.",
            }[detect_language(text)]
            await emit({"type": "assistant.start", "id": msg_id, "via": provider.describe()})
            await emit({"type": "assistant.delta", "id": msg_id, "text": fallback})
            full_text = fallback
        await emit({"type": "assistant.end", "id": msg_id, "text": full_text, "via": provider.describe(), "interrupted": cancel.is_set()})
        new_entries.append({"role": "assistant", "content": full_text})
        return new_entries


# Re-exported for callers that only need the events type.
__all__ = ["Agent", "StreamEvent"]
