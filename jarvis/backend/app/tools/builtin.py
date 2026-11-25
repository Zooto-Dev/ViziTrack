"""Built-in tools: clock, system status, open website / app, memory, tasks.

Desktop actions are implemented per OS.  Windows is the primary target;
macOS and Linux work where the equivalent command exists.  Every handler
returns what *actually* happened; failures raise or return ok=False.
"""

from __future__ import annotations

import datetime as dt
import platform
import shutil
import subprocess
import webbrowser
from typing import Any
from urllib.parse import quote_plus, urlparse

from ..memory.store import MemoryStore
from ..monitor import quick_status
from .registry import ToolResult, registry

OS = platform.system()  # "Windows" | "Darwin" | "Linux"

# Friendly name -> what to launch per OS.  Users say "chrome", "excel", "vs code"...
APP_ALIASES: dict[str, dict[str, str | list[str]]] = {
    "chrome": {"Windows": "chrome", "Darwin": "Google Chrome", "Linux": ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]},
    "edge": {"Windows": "msedge", "Darwin": "Microsoft Edge", "Linux": ["microsoft-edge"]},
    "firefox": {"Windows": "firefox", "Darwin": "Firefox", "Linux": ["firefox"]},
    "notepad": {"Windows": "notepad", "Darwin": "TextEdit", "Linux": ["gedit", "mousepad", "kate", "xed"]},
    "calculator": {"Windows": "calc", "Darwin": "Calculator", "Linux": ["gnome-calculator", "kcalc"]},
    "explorer": {"Windows": "explorer", "Darwin": "Finder", "Linux": ["nautilus", "dolphin", "thunar"]},
    "file manager": {"Windows": "explorer", "Darwin": "Finder", "Linux": ["nautilus", "dolphin", "thunar"]},
    "excel": {"Windows": "excel", "Darwin": "Microsoft Excel", "Linux": ["libreoffice", "--calc"]},
    "word": {"Windows": "winword", "Darwin": "Microsoft Word", "Linux": ["libreoffice", "--writer"]},
    "powerpoint": {"Windows": "powerpnt", "Darwin": "Microsoft PowerPoint", "Linux": ["libreoffice", "--impress"]},
    "outlook": {"Windows": "outlook", "Darwin": "Microsoft Outlook", "Linux": ["thunderbird"]},
    "vs code": {"Windows": "code", "Darwin": "Visual Studio Code", "Linux": ["code"]},
    "vscode": {"Windows": "code", "Darwin": "Visual Studio Code", "Linux": ["code"]},
    "code": {"Windows": "code", "Darwin": "Visual Studio Code", "Linux": ["code"]},
    "terminal": {"Windows": "wt", "Darwin": "Terminal", "Linux": ["gnome-terminal", "konsole", "xterm"]},
    "cmd": {"Windows": "cmd", "Darwin": "Terminal", "Linux": ["gnome-terminal", "konsole", "xterm"]},
    "powershell": {"Windows": "powershell", "Darwin": "Terminal", "Linux": ["pwsh"]},
    "spotify": {"Windows": "spotify", "Darwin": "Spotify", "Linux": ["spotify"]},
    "whatsapp": {"Windows": "whatsapp", "Darwin": "WhatsApp", "Linux": []},
    "paint": {"Windows": "mspaint", "Darwin": "Preview", "Linux": ["gimp"]},
    "settings": {"Windows": "ms-settings:", "Darwin": "System Settings", "Linux": ["gnome-control-center"]},
    "task manager": {"Windows": "taskmgr", "Darwin": "Activity Monitor", "Linux": ["gnome-system-monitor"]},
    "camera": {"Windows": "microsoft.windows.camera:", "Darwin": "Photo Booth", "Linux": ["cheese"]},
    "telegram": {"Windows": "telegram", "Darwin": "Telegram", "Linux": ["telegram-desktop"]},
    "discord": {"Windows": "discord", "Darwin": "Discord", "Linux": ["discord"]},
    "vlc": {"Windows": "vlc", "Darwin": "VLC", "Linux": ["vlc"]},
}

# Sites people name without a URL.
SITE_ALIASES: dict[str, str] = {
    "youtube": "https://www.youtube.com",
    "google": "https://www.google.com",
    "gmail": "https://mail.google.com",
    "whatsapp web": "https://web.whatsapp.com",
    "whatsapp": "https://web.whatsapp.com",
    "facebook": "https://www.facebook.com",
    "instagram": "https://www.instagram.com",
    "twitter": "https://x.com",
    "x": "https://x.com",
    "linkedin": "https://www.linkedin.com",
    "github": "https://github.com",
    "chatgpt": "https://chatgpt.com",
    "claude": "https://claude.ai",
    "amazon": "https://www.amazon.in",
    "flipkart": "https://www.flipkart.com",
    "netflix": "https://www.netflix.com",
    "spotify web": "https://open.spotify.com",
    "maps": "https://maps.google.com",
    "google maps": "https://maps.google.com",
    "drive": "https://drive.google.com",
    "google drive": "https://drive.google.com",
    "docs": "https://docs.google.com",
    "sheets": "https://sheets.google.com",
    "calendar": "https://calendar.google.com",
    "meet": "https://meet.google.com",
    "zoom": "https://zoom.us",
    "stackoverflow": "https://stackoverflow.com",
    "reddit": "https://www.reddit.com",
    "wikipedia": "https://www.wikipedia.org",
}

_store: MemoryStore | None = None


def set_store(store: MemoryStore) -> None:
    global _store
    _store = store


def store() -> MemoryStore:
    if _store is None:
        raise RuntimeError("memory store not initialised")
    return _store


# --------------------------------------------------------------------------
# Clock & system
# --------------------------------------------------------------------------
@registry.tool(
    "get_time",
    "Get the current local date and time. Use when the user asks the time, date or day.",
    category="system",
)
def get_time() -> dict[str, Any]:
    now = dt.datetime.now().astimezone()
    clock = now.strftime("%I:%M %p").lstrip("0")
    date = now.strftime("%A, %d %B %Y")
    return {
        "message": f"{clock}, {date}",
        "time": clock,
        "date": date,
        "iso": now.isoformat(timespec="seconds"),
        "hour": now.hour,
        "minute": now.minute,
    }


@registry.tool(
    "system_status",
    "Live CPU, RAM and OS status of this computer. Use when asked about performance, memory, CPU or 'system status'.",
    category="system",
)
def system_status() -> dict[str, Any]:
    s = quick_status()
    msg = f"CPU {s['cpu']}% busy, RAM {s['ram_used']} of {s['ram_total']} GB used ({s['ram_pct']}%)"
    if s["disk_pct"] >= 0:
        msg += f", disk {s['disk_pct']}% full"
    return {"message": msg + f", {s['os']}", **s}


# --------------------------------------------------------------------------
# Desktop: websites and apps
# --------------------------------------------------------------------------
def resolve_url(target: str) -> str:
    t = target.strip().strip('"').strip("'")
    low = t.lower().rstrip("/")
    if low in SITE_ALIASES:
        return SITE_ALIASES[low]
    if low.startswith(("http://", "https://")):
        return t
    if "." in low and " " not in low:
        return "https://" + t
    # Anything else: search it.
    return "https://www.google.com/search?q=" + quote_plus(t)


def _open_url(url: str) -> bool:
    if OS == "Windows":
        # os.startfile hands the URL to the default browser without a console flash.
        import os

        os.startfile(url)  # type: ignore[attr-defined]
        return True
    if OS == "Darwin":
        return subprocess.run(["open", url], check=False).returncode == 0
    if shutil.which("xdg-open"):
        return subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) is not None
    return webbrowser.open(url)


@registry.tool(
    "open_website",
    "Open a website in the default browser. Accepts a URL, a site name like 'youtube' or 'gmail', "
    "or a search phrase (which is searched on Google).",
    {
        "type": "object",
        "properties": {"target": {"type": "string", "description": "URL, site name, or search phrase"}},
        "required": ["target"],
    },
    category="desktop",
    system_action=True,
)
def open_website(target: str) -> ToolResult:
    url = resolve_url(target)
    ok = _open_url(url)
    host = urlparse(url).netloc or url
    if not ok:
        return ToolResult(False, f"could not hand {url} to a browser")
    return ToolResult(True, f"opened {host}", {"url": url})


def _launch_windows(name: str) -> ToolResult:
    # `start` resolves App Paths, PATH and ms-settings: style URIs. It exits
    # non-zero and prints to stderr when nothing matches, so we can tell.
    proc = subprocess.run(
        ["cmd", "/c", "start", "", name], capture_output=True, text=True, timeout=15, creationflags=0x08000000
    )
    if proc.returncode != 0:
        return ToolResult(False, f"Windows could not find an app called '{name}'")
    return ToolResult(True, f"launched {name}")


def _launch_mac(name: str) -> ToolResult:
    proc = subprocess.run(["open", "-a", name], capture_output=True, text=True, timeout=15)
    if proc.returncode != 0:
        return ToolResult(False, proc.stderr.strip() or f"could not open {name}")
    return ToolResult(True, f"launched {name}")


def _launch_linux(candidates: list[str]) -> ToolResult:
    if not candidates:
        return ToolResult(False, "no Linux equivalent known for that app")
    exe, *args = candidates if candidates[0] in ("libreoffice",) else (candidates[0],)
    choices = [candidates[0]] if args else candidates
    for c in choices:
        if shutil.which(c):
            subprocess.Popen([c, *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            return ToolResult(True, f"launched {c}")
    return ToolResult(False, f"none of {choices} is installed")


@registry.tool(
    "open_app",
    "Launch a desktop application by name, e.g. 'chrome', 'excel', 'notepad', 'calculator', 'vs code', 'whatsapp'.",
    {
        "type": "object",
        "properties": {"name": {"type": "string", "description": "application name as the user said it"}},
        "required": ["name"],
    },
    category="desktop",
    system_action=True,
)
def open_app(name: str) -> ToolResult:
    key = name.strip().lower()
    alias = APP_ALIASES.get(key)
    if OS == "Windows":
        return _launch_windows(str(alias["Windows"]) if alias else key)
    if OS == "Darwin":
        return _launch_mac(str(alias["Darwin"]) if alias else name.strip())
    cands = list(alias["Linux"]) if alias else [key]  # type: ignore[arg-type]
    return _launch_linux(cands)


# --------------------------------------------------------------------------
# Memory
# --------------------------------------------------------------------------
@registry.tool(
    "remember",
    "Save a fact, preference or note to long-term memory so it can be recalled in future conversations. "
    "Use when the user says 'remember', 'yaad rakhna', 'note this'.",
    {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "the fact to remember, in the user's words"},
            "tags": {"type": "array", "items": {"type": "string"}, "description": "optional keywords"},
        },
        "required": ["text"],
    },
    category="memory",
)
def remember(text: str, tags: list[str] | None = None) -> ToolResult:
    mid = store().remember(text, tags)
    return ToolResult(True, f"saved to memory (#{mid}): {text}", {"id": mid})


@registry.tool(
    "recall",
    "Search long-term memory for things the user told you earlier. Use before answering questions about the user's "
    "own preferences, people, plans or facts they may have shared.",
    {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "what to look for; empty returns the latest memories"}},
    },
    category="memory",
)
def recall(query: str = "") -> ToolResult:
    rows = store().recall(query, limit=6)
    if not rows:
        return ToolResult(True, "no memories saved yet", {"memories": []})
    lines = [f"#{r['id']} ({dt.datetime.fromtimestamp(r['created_at']).strftime('%d %b')}): {r['text']}" for r in rows]
    return ToolResult(True, "\n".join(lines), {"memories": rows})


@registry.tool(
    "forget",
    "Delete one saved memory by its id. Only use when the user explicitly asks to forget something.",
    {"type": "object", "properties": {"memory_id": {"type": "integer"}}, "required": ["memory_id"]},
    risk="confirm",
    category="memory",
)
def forget(memory_id: int) -> ToolResult:
    ok = store().forget(memory_id)
    return ToolResult(ok, f"memory #{memory_id} deleted" if ok else f"no memory #{memory_id}")


# --------------------------------------------------------------------------
# Tasks
# --------------------------------------------------------------------------
@registry.tool(
    "add_task",
    "Add a to-do item for the user.",
    {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "due": {"type": "string", "description": "optional due date/time in the user's words"},
        },
        "required": ["title"],
    },
    category="tasks",
)
def add_task(title: str, due: str | None = None) -> ToolResult:
    t = store().add_task(title, due)
    return ToolResult(True, f"task #{t['id']} added: {t['title']}" + (f" (due {due})" if due else ""), {"task": t})


@registry.tool(
    "list_tasks",
    "List the user's tasks. status: 'pending' (default), 'done' or 'all'.",
    {"type": "object", "properties": {"status": {"type": "string", "enum": ["pending", "done", "all"]}}},
    category="tasks",
)
def list_tasks(status: str = "pending") -> ToolResult:
    rows = store().list_tasks(status)
    if not rows:
        return ToolResult(True, f"no {status} tasks", {"tasks": []})
    lines = [f"#{r['id']} [{r['status']}] {r['title']}" + (f" (due {r['due']})" if r.get("due") else "") for r in rows]
    return ToolResult(True, "\n".join(lines), {"tasks": rows})


@registry.tool(
    "complete_task",
    "Mark a task as done, by id or by matching words in its title.",
    {
        "type": "object",
        "properties": {"task_id": {"type": "integer"}, "title_match": {"type": "string"}},
    },
    category="tasks",
)
def complete_task(task_id: int | None = None, title_match: str | None = None) -> ToolResult:
    if task_id is None and not title_match:
        return ToolResult(False, "need task_id or title_match")
    t = store().complete_task(task_id, title_match)
    if not t:
        return ToolResult(False, "no matching pending task")
    return ToolResult(True, f"task #{t['id']} done: {t['title']}", {"task": t})


@registry.tool(
    "delete_task",
    "Delete a task permanently by id.",
    {"type": "object", "properties": {"task_id": {"type": "integer"}}, "required": ["task_id"]},
    risk="confirm",
    category="tasks",
)
def delete_task(task_id: int) -> ToolResult:
    ok = store().delete_task(task_id)
    return ToolResult(ok, f"task #{task_id} deleted" if ok else f"no task #{task_id}")
