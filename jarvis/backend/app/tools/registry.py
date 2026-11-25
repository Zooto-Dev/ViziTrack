"""Tool registry: the single source of truth for what Jarvis can *do*.

Every tool declares a JSON schema, a risk level and an async handler.
The brain may only report an action as done when the handler returned
successfully, so there is no way to "pretend" a task happened.

Risk levels
    safe     run immediately (open a website, read the clock)
    confirm  ask the user first (delete, send, install, anything irreversible)
"""

from __future__ import annotations

import asyncio
import inspect
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal

Risk = Literal["safe", "confirm"]
Handler = Callable[..., Awaitable[Any] | Any]


@dataclass
class ToolResult:
    ok: bool
    message: str  # what actually happened, in plain words (fed back to the LLM)
    data: dict[str, Any] = field(default_factory=dict)
    elapsed_ms: int = 0

    def to_llm(self) -> str:
        if self.ok:
            return self.message if not self.data else f"{self.message}\n{self.data}"
        return f"FAILED: {self.message}"


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Handler
    risk: Risk = "safe"
    category: str = "general"
    system_action: bool = False  # touches the OS (apps, files, settings)
    # Per-call check: return a reason to ask the user first, or None to run.
    confirm_if: Callable[[dict[str, Any]], str | None] | None = None

    def openai_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {"name": self.name, "description": self.description, "parameters": self.parameters},
        }

    def anthropic_schema(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.parameters}


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> Tool:
        if tool.name in self._tools:
            raise ValueError(f"duplicate tool {tool.name}")
        self._tools[tool.name] = tool
        return tool

    def tool(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any] | None = None,
        risk: Risk = "safe",
        category: str = "general",
        system_action: bool = False,
        confirm_if: Callable[[dict[str, Any]], str | None] | None = None,
    ) -> Callable[[Handler], Handler]:
        def deco(fn: Handler) -> Handler:
            self.register(
                Tool(
                    name=name,
                    description=description,
                    parameters=parameters or {"type": "object", "properties": {}},
                    handler=fn,
                    risk=risk,
                    category=category,
                    system_action=system_action,
                    confirm_if=confirm_if,
                )
            )
            return fn

        return deco

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def all(self) -> list[Tool]:
        return list(self._tools.values())

    def openai_schemas(self) -> list[dict[str, Any]]:
        return [t.openai_schema() for t in self._tools.values()]

    def anthropic_schemas(self) -> list[dict[str, Any]]:
        return [t.anthropic_schema() for t in self._tools.values()]

    def public_list(self) -> list[dict[str, Any]]:
        return [
            {"name": t.name, "description": t.description, "risk": t.risk, "category": t.category}
            for t in self._tools.values()
        ]

    def validate_args(self, tool: Tool, args: dict[str, Any]) -> str | None:
        """Minimal schema check: required keys present, primitive types match."""
        schema = tool.parameters or {}
        props = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in args or args[req] in (None, ""):
                return f"missing required argument '{req}'"
        type_map = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "array": list, "object": dict}
        for k, v in args.items():
            spec = props.get(k)
            if not spec:
                continue
            want = type_map.get(spec.get("type", ""))
            if want and v is not None and not isinstance(v, want):
                return f"argument '{k}' should be {spec.get('type')}"
        return None

    async def execute(self, name: str, args: dict[str, Any] | None = None) -> ToolResult:
        tool = self.get(name)
        if not tool:
            return ToolResult(False, f"unknown tool '{name}'")
        args = dict(args or {})
        err = self.validate_args(tool, args)
        if err:
            return ToolResult(False, err)
        t0 = time.perf_counter()
        try:
            if inspect.iscoroutinefunction(tool.handler):
                result = await tool.handler(**args)
            else:
                result = await asyncio.to_thread(tool.handler, **args)
        except TypeError as e:  # bad kwargs from the model
            return ToolResult(False, f"bad arguments: {e}")
        except Exception as e:  # noqa: BLE001 - surface every failure honestly
            return ToolResult(False, f"{type(e).__name__}: {e}")
        elapsed = int((time.perf_counter() - t0) * 1000)
        if isinstance(result, ToolResult):
            result.elapsed_ms = elapsed
            return result
        if isinstance(result, dict):
            return ToolResult(True, str(result.get("message", "done")), {k: v for k, v in result.items() if k != "message"}, elapsed)
        return ToolResult(True, str(result), {}, elapsed)


registry = ToolRegistry()
