"""SQLite-backed long-term memory, tasks and conversation history.

Plain SQLite with FTS5 keyword search: zero extra dependencies, instant on
a laptop, and good enough for "Jarvis, remember X" / "what did I tell you
about X".  Everything is synchronous and tiny; callers wrap it in
``asyncio.to_thread`` when on the event loop.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from ..config import DATA_DIR

DB_FILE = DATA_DIR / "jarvis.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(text, tags, content='memories', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text, tags) VALUES (new.id, new.text, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text, tags) VALUES('delete', old.id, old.text, old.tags);
END;
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    due TEXT,
    created_at REAL NOT NULL,
    completed_at REAL
);
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    messages TEXT NOT NULL,
    updated_at REAL NOT NULL
);
"""


class MemoryStore:
    def __init__(self, path: Path | str = DB_FILE) -> None:
        self._path = str(path)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)

    def close(self) -> None:
        self._conn.close()

    # -- memories --------------------------------------------------------
    def remember(self, text: str, tags: list[str] | None = None) -> int:
        text = text.strip()
        if not text:
            raise ValueError("empty memory")
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO memories(text, tags, created_at) VALUES (?,?,?)",
                (text, " ".join(tags or []), time.time()),
            )
            self._conn.commit()
            return int(cur.lastrowid)

    def recall(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        query = query.strip()
        with self._lock:
            rows: list[sqlite3.Row] = []
            if query:
                # Each word becomes a prefix term so "excel report" finds "Excel reports".
                terms = [w for w in "".join(c if c.isalnum() or c.isspace() else " " for c in query).split() if w]
                if terms:
                    fts = " OR ".join(f'"{t}"*' for t in terms)
                    try:
                        rows = self._conn.execute(
                            "SELECT m.* FROM memories_fts f JOIN memories m ON m.id=f.rowid "
                            "WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?",
                            (fts, limit),
                        ).fetchall()
                    except sqlite3.OperationalError:
                        rows = []
            if not rows:
                rows = self._conn.execute(
                    "SELECT * FROM memories ORDER BY created_at DESC LIMIT ?", (limit,)
                ).fetchall()
        return [dict(r) for r in rows]

    def recent_memories(self, limit: int = 10) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM memories ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def forget(self, memory_id: int) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM memories WHERE id=?", (memory_id,))
            self._conn.commit()
            return cur.rowcount > 0

    # -- tasks -----------------------------------------------------------
    def add_task(self, title: str, due: str | None = None) -> dict[str, Any]:
        title = title.strip()
        if not title:
            raise ValueError("empty task")
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO tasks(title, due, created_at) VALUES (?,?,?)", (title, due, time.time())
            )
            self._conn.commit()
            row = self._conn.execute("SELECT * FROM tasks WHERE id=?", (cur.lastrowid,)).fetchone()
        return dict(row)

    def list_tasks(self, status: str = "pending", limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            if status == "all":
                rows = self._conn.execute(
                    "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?", (limit,)
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT * FROM tasks WHERE status=? ORDER BY created_at ASC LIMIT ?", (status, limit)
                ).fetchall()
        return [dict(r) for r in rows]

    def complete_task(self, task_id: int | None = None, title_match: str | None = None) -> dict[str, Any] | None:
        with self._lock:
            row = None
            if task_id is not None:
                row = self._conn.execute("SELECT * FROM tasks WHERE id=? AND status='pending'", (task_id,)).fetchone()
            elif title_match:
                row = self._conn.execute(
                    "SELECT * FROM tasks WHERE status='pending' AND lower(title) LIKE ? ORDER BY created_at LIMIT 1",
                    (f"%{title_match.lower()}%",),
                ).fetchone()
            if not row:
                return None
            self._conn.execute(
                "UPDATE tasks SET status='done', completed_at=? WHERE id=?", (time.time(), row["id"])
            )
            self._conn.commit()
            row = self._conn.execute("SELECT * FROM tasks WHERE id=?", (row["id"],)).fetchone()
        return dict(row)

    def delete_task(self, task_id: int) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
            self._conn.commit()
            return cur.rowcount > 0

    # -- conversations ---------------------------------------------------
    def save_conversation(self, conv_id: str, messages: list[dict[str, Any]]) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO conversations(id, messages, updated_at) VALUES (?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET messages=excluded.messages, updated_at=excluded.updated_at",
                (conv_id, json.dumps(messages, ensure_ascii=False), time.time()),
            )
            self._conn.commit()

    def load_conversation(self, conv_id: str) -> list[dict[str, Any]]:
        with self._lock:
            row = self._conn.execute("SELECT messages FROM conversations WHERE id=?", (conv_id,)).fetchone()
        return json.loads(row["messages"]) if row else []

    def latest_conversation_id(self) -> str | None:
        with self._lock:
            row = self._conn.execute("SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1").fetchone()
        return row["id"] if row else None
