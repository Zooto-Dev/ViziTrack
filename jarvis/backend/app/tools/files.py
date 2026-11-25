"""File tools: find, open, read (Excel / PDF / Word / text) and write files.

Safety rules
* Searching and reading never change anything.
* open_file never runs programs or scripts: executables are refused, and code
  files open in an editor instead of being executed.
* write_file saves into the user's FRIDAY folder (Documents/FRIDAY).  Writing
  anywhere else, or replacing an existing file, asks the user first.
"""

from __future__ import annotations

import datetime as dt
import os
import platform
import re
import shutil
import string
import subprocess
import time
import zipfile
from pathlib import Path
from typing import Any

from .registry import ToolResult, registry

OS = platform.system()

KIND_EXT: dict[str, list[str]] = {
    "excel": ["xlsx", "xlsm", "xls", "csv"],
    "word": ["docx", "doc", "rtf"],
    "pdf": ["pdf"],
    "powerpoint": ["pptx", "ppt"],
    "image": ["jpg", "jpeg", "png", "gif", "webp", "bmp"],
    "video": ["mp4", "mkv", "avi", "mov"],
    "audio": ["mp3", "wav", "m4a", "aac"],
    "text": ["txt", "md", "log"],
    "code": ["py", "js", "ts", "tsx", "jsx", "html", "css", "java", "c", "cpp", "cs", "go", "rs", "php", "rb", "sql", "json", "gs"],
}
KINDS = list(KIND_EXT)

# Never launched by open_file: these would run a program.
EXECUTABLE_EXT = {
    "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "psm1", "vbs", "vbe", "js_", "jse", "wsf", "wsh",
    "lnk", "reg", "hta", "cpl", "msc", "jar", "pif", "appx", "msix", "sh",
}
# Opened in an editor, because their default action may be "run".
CODE_EXT = set(KIND_EXT["code"]) | {"txt", "md", "log", "ini", "cfg", "yaml", "yml", "toml", "xml", "bat", "cmd", "ps1", "sh"}

SKIP_DIRS = {
    "node_modules", "appdata", "windows", "program files", "program files (x86)", "programdata",
    "system volume information", "__pycache__", ".venv", "venv", "site-packages", "recovery",
    "$recycle.bin", "msocache", "perflogs", "intel", "amd", "nvidia", "drivers",
}
SEARCH_SECONDS = 6.0
SEARCH_MAX_ENTRIES = 400_000


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def workspace() -> Path:
    d = Path(os.environ.get("JARVIS_WORKSPACE") or Path.home() / "Documents" / "FRIDAY")
    d.mkdir(parents=True, exist_ok=True)
    return d


def search_roots() -> list[Path]:
    env = os.environ.get("JARVIS_SEARCH_ROOTS")
    if env:
        return [Path(p) for p in env.split(os.pathsep) if p]
    home = Path.home()
    roots: list[Path] = []
    for name in ("Desktop", "Documents", "Downloads", "OneDrive", "Pictures", "Videos", "Music"):
        p = home / name
        if p.is_dir():
            roots.append(p)
    if OS == "Windows":
        # Other drives (D:, E:, ...) usually hold the user's own data.
        for letter in string.ascii_uppercase[3:]:
            p = Path(f"{letter}:\\")
            if p.exists():
                roots.append(p)
    return roots or [home]


def _fmt_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}"
        n /= 1024  # type: ignore[assignment]
    return f"{n:.1f} TB"


def _ext(p: Path) -> str:
    return p.suffix.lower().lstrip(".")


def _walk(roots: list[Path], want_ext: set[str] | None, words: list[str], deadline: float) -> list[tuple[float, Path, int]]:
    hits: list[tuple[float, Path, int]] = []
    seen = 0
    stack = [r for r in roots]
    visited: set[str] = set()
    while stack and time.monotonic() < deadline and seen < SEARCH_MAX_ENTRIES:
        d = stack.pop()
        key = str(d).lower()
        if key in visited:
            continue
        visited.add(key)
        try:
            with os.scandir(d) as it:
                for e in it:
                    seen += 1
                    name = e.name
                    low = name.lower()
                    try:
                        if e.is_dir(follow_symlinks=False):
                            if low.startswith((".", "$", "~")) or low in SKIP_DIRS:
                                continue
                            stack.append(Path(e.path))
                            continue
                        if not e.is_file(follow_symlinks=False) or low.startswith("~$"):
                            continue
                    except OSError:
                        continue
                    ext = low.rsplit(".", 1)[-1] if "." in low else ""
                    if want_ext and ext not in want_ext:
                        continue
                    if words and not all(w in low for w in words):
                        continue
                    try:
                        st = e.stat()
                    except OSError:
                        continue
                    hits.append((st.st_mtime, Path(e.path), st.st_size))
        except (PermissionError, FileNotFoundError, NotADirectoryError, OSError):
            continue
    return hits


def search(query: str = "", kind: str | None = None, extensions: list[str] | None = None, limit: int = 10) -> list[dict[str, Any]]:
    want: set[str] | None = None
    if kind and kind in KIND_EXT:
        want = set(KIND_EXT[kind])
    if extensions:
        want = (want or set()) | {e.lower().lstrip(".") for e in extensions}
    stop = {"file", "files", "my", "meri", "mera", "the", "latest", "new", "last", "recent", "wali", "wala", "ki", "ka"}
    words = [w for w in re.findall(r"[\w\-]+", query.lower()) if w not in stop]
    hits = _walk(search_roots(), want, words, time.monotonic() + SEARCH_SECONDS)
    hits.sort(key=lambda h: h[0], reverse=True)
    return [
        {
            "path": str(p),
            "name": p.name,
            "size": _fmt_size(size),
            "modified": dt.datetime.fromtimestamp(mtime).strftime("%d %b %Y %I:%M %p"),
        }
        for mtime, p, size in hits[: max(1, min(limit, 30))]
    ]


def _resolve(path: str) -> Path:
    p = Path(os.path.expandvars(os.path.expanduser(path.strip().strip('"'))))
    if not p.is_absolute():
        p = workspace() / p
    return p.resolve()


def _open_in_editor(p: Path) -> str:
    if OS == "Windows":
        if shutil.which("code"):
            subprocess.Popen(["cmd", "/c", "code", str(p)], creationflags=0x08000000)
            return "VS Code"
        subprocess.Popen(["notepad", str(p)])
        return "Notepad"
    if OS == "Darwin":
        if shutil.which("code"):
            subprocess.Popen(["code", str(p)])
            return "VS Code"
        subprocess.run(["open", "-t", str(p)], check=False)
        return "the text editor"
    for ed in ("code", "gedit", "kate", "mousepad", "xed"):
        if shutil.which(ed):
            subprocess.Popen([ed, str(p)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            return ed
    raise RuntimeError("no text editor found")


def _open_default(p: Path) -> None:
    if OS == "Windows":
        os.startfile(str(p))  # type: ignore[attr-defined]
    elif OS == "Darwin":
        subprocess.run(["open", str(p)], check=True)
    else:
        if not shutil.which("xdg-open"):
            raise RuntimeError("xdg-open not available")
        subprocess.Popen(["xdg-open", str(p)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def open_path(p: Path) -> ToolResult:
    if not p.exists():
        return ToolResult(False, f"file not found: {p}. Use find_files first to get the exact path.")
    ext = _ext(p)
    if p.is_file() and ext in EXECUTABLE_EXT - CODE_EXT:
        return ToolResult(False, f"{p.name} is a program; for safety open_file does not run programs. Use open_app for apps.")
    if p.is_file() and ext in CODE_EXT:
        editor = _open_in_editor(p)
        return ToolResult(True, f"opened {p.name} in {editor}", {"path": str(p)})
    _open_default(p)
    return ToolResult(True, f"opened {p.name}", {"path": str(p)})


# --------------------------------------------------------------------------
# tools
# --------------------------------------------------------------------------
@registry.tool(
    "find_files",
    "Search the user's files (Desktop, Documents, Downloads, OneDrive and other drives) by words in the file name "
    "and/or type. Results are newest first. Use before opening or reading a file whose exact path you don't know.",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "words from the file name, e.g. 'gst report'; empty = any name"},
            "kind": {"type": "string", "enum": KINDS, "description": "file type"},
            "limit": {"type": "integer", "description": "max results, default 8"},
        },
    },
    category="files",
)
def find_files(query: str = "", kind: str | None = None, limit: int = 8) -> ToolResult:
    rows = search(query, kind, None, limit)
    what = " ".join(x for x in [kind or "", f"'{query}'" if query else ""] if x) or "files"
    if not rows:
        return ToolResult(True, f"no {what} found", {"files": []})
    lines = [f"{i + 1}. {r['name']} ({r['modified']}, {r['size']}) - {r['path']}" for i, r in enumerate(rows)]
    return ToolResult(True, f"found {len(rows)} {what}:\n" + "\n".join(lines), {"files": rows})


@registry.tool(
    "open_file",
    "Open a file or folder with its normal app (Excel for .xlsx, PDF viewer, Word...). Code and text files open in "
    "an editor. Never runs programs. Needs the full path from find_files.",
    {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
    category="files",
    system_action=True,
)
def open_file(path: str) -> ToolResult:
    return open_path(_resolve(path))


@registry.tool(
    "open_latest_file",
    "Find the most recently changed file of a type (optionally matching words) and open it. "
    "Use for 'open my latest Excel report', 'last PDF kholo'.",
    {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": KINDS},
            "query": {"type": "string", "description": "optional words from the file name"},
        },
        "required": ["kind"],
    },
    category="files",
    system_action=True,
)
def open_latest_file(kind: str, query: str = "") -> ToolResult:
    rows = search(query, kind, None, 1)
    if not rows:
        what = f"{kind} file" + (f" matching '{query}'" if query else "")
        return ToolResult(False, f"no {what} found on this computer")
    res = open_path(Path(rows[0]["path"]))
    if res.ok:
        res.message = f"opened {rows[0]['name']} (modified {rows[0]['modified']})"
        res.data = {"file": rows[0]}
    return res


def _read_xlsx(p: Path, limit: int) -> str:
    try:
        import openpyxl
    except ImportError as e:
        raise RuntimeError("Excel reading needs the openpyxl package; restart FRIDAY with start.bat to install it") from e
    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    out: list[str] = []
    try:
        for ws in wb.worksheets[:5]:
            out.append(f"## Sheet: {ws.title}")
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i >= 80:
                    out.append("... (more rows)")
                    break
                cells = ["" if v is None else str(v) for v in row]
                while cells and cells[-1] == "":
                    cells.pop()
                if cells:
                    out.append(" | ".join(cells))
                if sum(len(x) for x in out) > limit:
                    break
    finally:
        wb.close()
    return "\n".join(out)


def _read_pdf(p: Path, limit: int) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as e:
        raise RuntimeError("PDF reading needs the pypdf package; restart FRIDAY with start.bat to install it") from e
    reader = PdfReader(str(p))
    out: list[str] = []
    for i, page in enumerate(reader.pages[:30]):
        out.append(f"## Page {i + 1}\n{page.extract_text() or ''}")
        if sum(len(x) for x in out) > limit:
            break
    return "\n".join(out)


def _read_docx(p: Path) -> str:
    with zipfile.ZipFile(p) as z:
        xml = z.read("word/document.xml").decode("utf-8", "replace")
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:tab/>", "\t", xml)
    text = re.sub(r"<[^>]+>", "", xml)
    return re.sub(r"&amp;", "&", re.sub(r"&lt;", "<", re.sub(r"&gt;", ">", text)))


@registry.tool(
    "read_file",
    "Read the text of a file so you can summarise or answer questions about it. Supports Excel (.xlsx), CSV, PDF, "
    "Word (.docx) and text/code files. Needs the full path from find_files.",
    {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "max_chars": {"type": "integer", "description": "default 6000"},
        },
        "required": ["path"],
    },
    category="files",
)
def read_file(path: str, max_chars: int = 6000) -> ToolResult:
    p = _resolve(path)
    if not p.is_file():
        return ToolResult(False, f"file not found: {p}. Use find_files first to get the exact path.")
    limit = max(1000, min(max_chars, 40000))
    ext = _ext(p)
    if ext in ("xlsx", "xlsm"):
        text = _read_xlsx(p, limit)
    elif ext == "pdf":
        text = _read_pdf(p, limit)
    elif ext == "docx":
        text = _read_docx(p)
    elif ext in ("xls", "doc", "ppt", "pptx"):
        return ToolResult(False, f".{ext} files can't be read yet; save it as .xlsx/.docx/.pdf, or open it with open_file")
    else:
        raw = p.read_bytes()[: limit * 4]
        if b"\x00" in raw[:4096]:
            return ToolResult(False, f"{p.name} is a binary file and can't be read as text")
        text = raw.decode("utf-8", "replace")
    truncated = len(text) > limit
    text = text[:limit]
    note = "\n... (truncated)" if truncated else ""
    return ToolResult(True, f"Contents of {p.name}:\n{text}{note}", {"path": str(p), "chars": len(text), "truncated": truncated})


def _write_needs_confirm(args: dict[str, Any]) -> str | None:
    p = _resolve(str(args.get("filename", "")))
    ws = workspace().resolve()
    if not p.is_relative_to(ws):
        return f"FRIDAY wants to save a file outside your FRIDAY folder: {p}"
    if p.exists():
        return f"{p.name} already exists in your FRIDAY folder. Replace it?"
    return None


@registry.tool(
    "write_file",
    "Save text or code to a file in the user's FRIDAY folder (Documents/FRIDAY) and open it. Use this whenever the "
    "user asks you to write code, a script, a letter or notes. Give a sensible file name with the right extension.",
    {
        "type": "object",
        "properties": {
            "filename": {"type": "string", "description": "e.g. 'invoice_calculator.py' or 'leave_letter.txt'"},
            "content": {"type": "string", "description": "full file content"},
            "open_after": {"type": "boolean", "description": "open the file after saving (default true)"},
        },
        "required": ["filename", "content"],
    },
    category="files",
    confirm_if=_write_needs_confirm,
)
def write_file(filename: str, content: str, open_after: bool = True) -> ToolResult:
    p = _resolve(filename)
    if _ext(p) in EXECUTABLE_EXT - CODE_EXT:
        return ToolResult(False, f"won't create .{_ext(p)} files for safety")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    msg = f"saved {p.name} ({len(content.splitlines())} lines) to {p.parent}"
    if open_after:
        try:
            opened = open_path(p)
            if opened.ok:
                msg += f" and {opened.message}"
        except Exception as e:  # noqa: BLE001 - saving worked even if opening didn't
            msg += f" (could not open it: {e})"
    return ToolResult(True, msg, {"path": str(p)})
