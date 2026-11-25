from app.brain.context import estimate_tokens, fit_history, select_tools, split_turns
from app.brain.providers.openai_compat import parse_retry_after
from app.tools import builtin, files  # noqa: F401
from app.tools.registry import registry


def turn(i, tool_text="x" * 5000):
    return [
        {"role": "user", "content": f"question {i}"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": f"c{i}", "name": "read_file", "args": {"path": "a", "content": "y" * 3000}}]},
        {"role": "tool", "tool_call_id": f"c{i}", "name": "read_file", "content": tool_text},
        {"role": "assistant", "content": f"answer {i}"},
    ]


def test_keeps_newest_turns_and_trims_old_results():
    history = [m for i in range(10) for m in turn(i)]
    out = fit_history(history, 400)
    assert out and out[0]["role"] == "user"
    assert out[-1]["content"] == "answer 9"  # newest kept
    assert "question 0" not in [m.get("content") for m in out]  # oldest dropped
    tool = next(m for m in out if m["role"] == "tool")
    assert len(tool["content"]) < 400  # 5000-char result trimmed
    call = next(m for m in out if m.get("tool_calls"))
    assert len(call["tool_calls"][0]["args"]["content"]) < 300
    assert sum(estimate_tokens(str(m.get("content"))) for m in out) <= 400


def test_never_starts_with_orphan_tool_result():
    history = turn(0)[2:] + turn(1)  # starts with a tool result whose call is gone
    turns = split_turns(history)
    assert all(t[0]["role"] == "user" for t in turns)
    assert fit_history(history, 10_000)[0]["content"] == "question 1"


def test_lean_tools_only_when_files_are_not_mentioned():
    tools = registry.all()
    names = lambda ts: {t.name for t in ts}
    assert "read_file" not in names(select_tools(tools, "aaj ka mausam kaisa hai", []))
    assert "read_file" in names(select_tools(tools, "meri excel report ka summary do", []))
    assert "write_file" in names(select_tools(tools, "ek python script likho", []))
    # A follow-up right after using file tools keeps them.
    recent = turn(0)
    assert "read_file" in names(select_tools(tools, "aur iska total kya hai", recent))


def test_retry_after_parsing():
    assert parse_retry_after("7", "") == 7.0
    assert parse_retry_after(None, "Please try again in 7.36s.") == 7.36
    assert parse_retry_after(None, "Please try again in 1m2.5s.") == 62.5
    assert parse_retry_after(None, "try again in 250ms") == 0.25
    assert parse_retry_after(None, "nothing") is None
