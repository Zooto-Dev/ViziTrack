import asyncio

import pytest

from app.memory.store import MemoryStore
from app.tools import builtin
from app.tools.registry import ToolResult, registry


@pytest.fixture()
def store(tmp_path):
    s = MemoryStore(tmp_path / "t.db")
    builtin.set_store(s)
    yield s
    s.close()


def test_memory_roundtrip(store):
    store.remember("my car number is DL8C1234", ["car"])
    store.remember("meeting with Rahul on Friday 5pm")
    hits = store.recall("car number")
    assert hits and "DL8C1234" in hits[0]["text"]
    hits = store.recall("rahul")
    assert hits and "Rahul" in hits[0]["text"]
    # Unknown query falls back to most recent so recall never returns nothing silently.
    assert store.recall("zzzz-nothing")
    assert store.forget(hits[0]["id"]) is True


def test_tasks(store):
    t = store.add_task("buy milk", "tonight")
    store.add_task("send report")
    assert [x["title"] for x in store.list_tasks()] == ["buy milk", "send report"]
    done = store.complete_task(title_match="milk")
    assert done and done["status"] == "done" and done["id"] == t["id"]
    assert [x["title"] for x in store.list_tasks()] == ["send report"]
    assert len(store.list_tasks("all")) == 2


def test_conversation_persistence(store):
    store.save_conversation("c1", [{"role": "user", "content": "hi"}])
    assert store.load_conversation("c1") == [{"role": "user", "content": "hi"}]
    assert store.latest_conversation_id() == "c1"


def test_registry_executes_and_validates(store):
    res = asyncio.run(registry.execute("get_time", {}))
    assert res.ok and res.data["hour"] in range(24)
    res = asyncio.run(registry.execute("remember", {}))
    assert not res.ok and "missing required" in res.message
    res = asyncio.run(registry.execute("remember", {"text": "pizza is my favourite"}))
    assert res.ok and "#" in res.message
    res = asyncio.run(registry.execute("recall", {"query": "favourite"}))
    assert res.ok and "pizza" in res.message
    res = asyncio.run(registry.execute("no_such_tool", {}))
    assert not res.ok


def test_open_app_reports_failure_honestly(store):
    res = asyncio.run(registry.execute("open_app", {"name": "definitely-not-an-app-xyz"}))
    assert isinstance(res, ToolResult)
    assert res.ok is False


def test_url_resolution():
    assert builtin.resolve_url("youtube") == "https://www.youtube.com"
    assert builtin.resolve_url("github.com/foo") == "https://github.com/foo"
    assert builtin.resolve_url("https://x.com") == "https://x.com"
    assert builtin.resolve_url("weather in delhi").startswith("https://www.google.com/search?q=weather+in+delhi")


def test_schemas_are_well_formed():
    for t in registry.all():
        oa = t.openai_schema()
        assert oa["function"]["name"] == t.name and oa["function"]["parameters"]["type"] == "object"
        an = t.anthropic_schema()
        assert an["input_schema"]["type"] == "object"
