"""Keep each AI request small.

Free tiers (Groq) cap tokens per minute, and local models on a CPU pay for
every token, so the agent sends only what helps answer the current message:
* the newest whole turns of conversation that fit a token budget,
* older tool results cut short (the model already answered from them),
* for "lean" providers, only the tools that fit the message.
"""

from __future__ import annotations

import json
import re
from typing import Any

from ..tools.registry import Tool

OLD_TOOL_CHARS = 300
OLD_ARG_CHARS = 200


def estimate_tokens(text: str) -> int:
    """Rough count: ~3.5 Latin characters per token, about one per Devanagari character."""
    dev = sum(1 for c in text if "ऀ" <= c <= "ॿ")
    return int((len(text) - dev) / 3.5 + dev * 0.9) + 4


def message_tokens(m: dict[str, Any]) -> int:
    n = estimate_tokens(str(m.get("content") or ""))
    for tc in m.get("tool_calls") or []:
        n += estimate_tokens(tc.get("name", "") + json.dumps(tc.get("args", {}), ensure_ascii=False))
    return n


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + " ... (trimmed)"


def shrink_old(m: dict[str, Any]) -> dict[str, Any]:
    """An earlier message, with long tool results and tool arguments cut down."""
    if m.get("role") == "tool":
        return {**m, "content": _cut(str(m.get("content", "")), OLD_TOOL_CHARS)}
    if m.get("tool_calls"):
        calls = []
        for tc in m["tool_calls"]:
            args = {k: _cut(v, OLD_ARG_CHARS) if isinstance(v, str) else v for k, v in (tc.get("args") or {}).items()}
            calls.append({**tc, "args": args})
        return {**m, "tool_calls": calls}
    return m


def split_turns(history: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group messages into turns that each start with a user message."""
    turns: list[list[dict[str, Any]]] = []
    for m in history:
        if m.get("role") == "user" or not turns:
            turns.append([m])
        else:
            turns[-1].append(m)
    # A leading turn without its user message would leave orphan tool results.
    return [t for t in turns if t and t[0].get("role") == "user"]


def fit_history(history: list[dict[str, Any]], budget_tokens: int, max_messages: int = 40) -> list[dict[str, Any]]:
    """Newest whole turns that fit the budget, oldest dropped first."""
    out: list[dict[str, Any]] = []
    used = 0
    for turn in reversed(split_turns(history[-max_messages:])):
        small = [shrink_old(m) for m in turn]
        cost = sum(message_tokens(m) for m in small)
        if used + cost > budget_tokens:
            break
        out = small + out
        used += cost
    return out


def cap_tool_result(text: str, limit: int) -> str:
    return _cut(text, limit)


# Words that mean the user is talking about files, documents or code.
FILE_HINT = re.compile(
    r"file|excel|xlsx|xls|sheet|pdf|word|docx|\bdoc\b|report|csv|ppt|folder|document|summar|padh|read|"
    r"code|script|program|likh|write|save|letter|notes|python|html|javascript|\.py\b|"
    r"फाइल|फ़ाइल|एक्सेल|पीडीएफ|कोड|लिखो|पढ़ो|सारांश|रिपोर्ट",
    re.IGNORECASE,
)


def select_tools(tools: list[Tool], text: str, recent: list[dict[str, Any]]) -> list[Tool]:
    """All tools, minus file tools when nothing points at files (saves ~40% of the tool list)."""
    used_files_recently = any(
        tc.get("name") in {t.name for t in tools if t.category == "files"}
        for m in recent[-6:]
        for tc in (m.get("tool_calls") or [])
    )
    if FILE_HINT.search(text) or used_files_recently:
        return tools
    return [t for t in tools if t.category != "files"]
