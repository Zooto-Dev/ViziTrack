"""File tools against a fake home folder: find, open (no programs), read, write."""

from __future__ import annotations

import asyncio
import os
import time
import zipfile
from pathlib import Path

import pytest

from app.tools import files
from app.tools.registry import registry


@pytest.fixture()
def fake_home(tmp_path, monkeypatch):
    docs = tmp_path / "Documents"
    (docs / "reports").mkdir(parents=True)
    (tmp_path / "Desktop").mkdir()
    (docs / "node_modules" / "pkg").mkdir(parents=True)
    (docs / ".git").mkdir()
    ws = tmp_path / "Documents" / "Jarvis"
    monkeypatch.setenv("JARVIS_SEARCH_ROOTS", os.pathsep.join([str(docs), str(tmp_path / "Desktop")]))
    monkeypatch.setenv("JARVIS_WORKSPACE", str(ws))
    opened: list[tuple[str, str]] = []
    monkeypatch.setattr(files, "_open_default", lambda p: opened.append(("default", str(p))))
    monkeypatch.setattr(files, "_open_in_editor", lambda p: opened.append(("editor", str(p))) or "VS Code")
    return tmp_path, opened


def _xlsx(path: Path, rows):
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sales"
    for r in rows:
        ws.append(r)
    wb.save(path)


def _docx(path: Path, paragraphs):
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    xml = f'<?xml version="1.0"?><w:document xmlns:w="x"><w:body>{body}</w:body></w:document>'
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("word/document.xml", xml)


def run(name, **args):
    return asyncio.run(registry.execute(name, args))


def test_find_newest_first_and_skip_system_folders(fake_home):
    home, _ = fake_home
    old = home / "Documents" / "reports" / "GST Report Oct.xlsx"
    new = home / "Desktop" / "GST Report Nov.xlsx"
    _xlsx(old, [["a"]])
    _xlsx(new, [["b"]])
    _xlsx(home / "Documents" / "node_modules" / "pkg" / "GST Report hidden.xlsx", [["c"]])
    _xlsx(home / "Documents" / ".git" / "GST Report hidden2.xlsx", [["c"]])
    (home / "Documents" / "~$GST Report Nov.xlsx").write_text("lock file")
    os.utime(old, (time.time() - 86400, time.time() - 86400))

    res = run("find_files", query="gst report", kind="excel")
    assert res.ok
    names = [f["name"] for f in res.data["files"]]
    assert names == ["GST Report Nov.xlsx", "GST Report Oct.xlsx"]  # newest first; node_modules, hidden folders and lock files skipped
    assert run("find_files", query="nothing-like-this").message.startswith("no ")


def test_open_latest_file_opens_newest(fake_home):
    home, opened = fake_home
    a = home / "Documents" / "a.xlsx"
    b = home / "Documents" / "reports" / "b.xlsx"
    _xlsx(a, [["x"]])
    _xlsx(b, [["y"]])
    os.utime(a, (time.time() - 100, time.time() - 100))
    res = run("open_latest_file", kind="excel")
    assert res.ok and "b.xlsx" in res.message
    assert opened == [("default", str(b))]
    assert not run("open_latest_file", kind="pdf").ok


def test_open_file_never_runs_programs(fake_home):
    home, opened = fake_home
    exe = home / "Desktop" / "setup.exe"
    exe.write_bytes(b"MZ")
    script = home / "Desktop" / "tool.py"
    script.write_text("print('hi')")
    res = run("open_file", path=str(exe))
    assert not res.ok and "program" in res.message
    res = run("open_file", path=str(script))
    assert res.ok and "VS Code" in res.message
    assert opened == [("editor", str(script))]  # opened for editing, not executed
    assert not run("open_file", path=str(home / "missing.xlsx")).ok


def test_read_excel_word_text_pdf(fake_home):
    home, _ = fake_home
    x = home / "Documents" / "sales.xlsx"
    _xlsx(x, [["Month", "Amount"], ["Oct", 1200], ["Nov", 1550]])
    res = run("read_file", path=str(x))
    assert res.ok and "Sheet: Sales" in res.message and "Nov | 1550" in res.message

    d = home / "Documents" / "letter.docx"
    _docx(d, ["Dear Sir,", "Please approve my leave."])
    res = run("read_file", path=str(d))
    assert res.ok and "Please approve my leave." in res.message

    t = home / "Documents" / "notes.txt"
    t.write_text("line one\nline two")
    assert "line two" in run("read_file", path=str(t)).message

    from pypdf import PdfWriter

    pdf = home / "Documents" / "blank.pdf"
    w = PdfWriter()
    w.add_blank_page(200, 200)
    with open(pdf, "wb") as f:
        w.write(f)
    res = run("read_file", path=str(pdf))
    assert res.ok and "Page 1" in res.message

    binf = home / "Documents" / "data.bin"
    binf.write_bytes(b"\x00\x01\x02" * 100)
    assert not run("read_file", path=str(binf)).ok


def test_write_file_goes_to_jarvis_folder_and_confirms_overwrite(fake_home):
    home, opened = fake_home
    ws = home / "Documents" / "Jarvis"
    tool = registry.get("write_file")
    assert tool and tool.confirm_if
    # New file in the Jarvis folder: no question asked.
    assert tool.confirm_if({"filename": "hello.py", "content": "x"}) is None
    res = run("write_file", filename="hello.py", content="print('hello')\n")
    assert res.ok and (ws / "hello.py").read_text() == "print('hello')\n"
    assert opened[-1] == ("editor", str(ws / "hello.py"))
    # Replacing it, or writing outside the folder, needs confirmation.
    assert "already exists" in tool.confirm_if({"filename": "hello.py", "content": "y"})
    assert "outside" in tool.confirm_if({"filename": str(home / "Desktop" / "x.txt"), "content": "y"})
    assert "outside" in tool.confirm_if({"filename": "../escape.txt", "content": "y"})
    # Never creates executables.
    assert not run("write_file", filename="virus.exe", content="x").ok
