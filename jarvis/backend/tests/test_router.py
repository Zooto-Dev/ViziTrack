from app.brain.router import detect_language, phrase_result, route


def r(text):
    m = route(text)
    return (m.intent, m.tool, m.args) if m else None


def test_language_detection():
    assert detect_language("क्रोम खोलो") == "hindi"
    assert detect_language("chrome kholo yaar") == "hinglish"
    assert detect_language("open chrome please") == "english"
    assert detect_language("what do i have pending") == "english"


def test_open_app_variants():
    assert r("open chrome") == ("tool", "open_app", {"name": "chrome"})
    assert r("chrome kholo") == ("tool", "open_app", {"name": "chrome"})
    assert r("Hey Jarvis, open notepad please") == ("tool", "open_app", {"name": "notepad"})
    assert r("क्रोम खोलो") == ("tool", "open_app", {"name": "chrome"})
    assert r("calc khol do") == ("tool", "open_app", {"name": "calculator"})


def test_open_site_variants():
    assert r("youtube khol do") == ("tool", "open_website", {"target": "youtube"})
    assert r("open gmail") == ("tool", "open_website", {"target": "gmail"})
    assert r("open github.com") == ("tool", "open_website", {"target": "github.com"})
    assert r("यूट्यूब खोल दो") == ("tool", "open_website", {"target": "youtube"})


def test_unknown_open_goes_to_llm():
    assert r("open my excel report from yesterday") is None
    assert r("open the door") is None


def test_stop():
    for t in ["stop", "ruko", "Jarvis stop speaking", "chup", "रुको", "bas karo"]:
        assert r(t) == ("stop", None, {}), t


def test_time_status_tasks():
    assert r("time kya hua")[1] == "get_time"
    assert r("what time is it?")[1] == "get_time"
    assert r("system status")[1] == "system_status"
    assert r("cpu kitna use ho raha hai")[1] == "system_status"
    assert r("mere pending tasks kya hai")[1] == "list_tasks"
    assert r("what tasks do I have pending")[1] == "list_tasks"


def test_remember_and_task():
    assert r("yaad rakhna meri meeting 5 baje hai") == ("tool", "remember", {"text": "meri meeting 5 baje hai"})
    assert r("remember that my car number is DL8C1234") == ("tool", "remember", {"text": "my car number is DL8C1234"})
    assert r("meri car ka number DL8C1234 hai yaad rakhna") == ("tool", "remember", {"text": "meri car ka number DL8C1234 hai"})
    assert r("add task buy milk") == ("tool", "add_task", {"title": "buy milk"})


def test_search():
    assert r("google karo weather in delhi") == ("tool", "open_website", {"target": "weather in delhi"})
    assert r("search for best laptops under 50000") == ("tool", "open_website", {"target": "best laptops under 50000"})
    # File searches are not web searches: leave them to the LLM/file tools.
    assert r("search my excel files") is None


def test_general_questions_go_to_llm():
    assert r("mujhe batao bharat ki rajdhani kya hai") is None
    assert r("kya haal hai") is None
    assert r("write a poem about rain") is None


def test_phrasing_mirrors_language():
    assert "khol diya" in phrase_result("open_website", True, "opened youtube", {"url": "https://www.youtube.com"}, "hinglish", "Sir")
    assert phrase_result("open_app", True, "launched chrome", {}, "english", "Sir") == "Launching chrome."
    assert "नहीं हो सका" in phrase_result("open_app", False, "nope", {}, "hindi", "Sir")
