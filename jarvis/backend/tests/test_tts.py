import pytest

from app import voice_tts


def test_voice_choice_follows_script():
    assert voice_tts.pick_voice("Aapke teen kaam pending hain.", "en-IN-NeerjaNeural") == "en-IN-NeerjaNeural"
    assert voice_tts.pick_voice("आपके तीन काम बाकी हैं।", "en-IN-NeerjaNeural") == "hi-IN-SwaraNeural"
    assert voice_tts.pick_voice("hello", "not-a-voice") == "en-IN-NeerjaNeural"
    assert voice_tts.rate_str(1.05) == "+5%" and voice_tts.rate_str(0.9) == "-10%"


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fake_edge(monkeypatch):
    import edge_tts

    calls = []

    class FakeCommunicate:
        def __init__(self, text, voice, **kw):
            calls.append((text, voice, kw.get("rate")))
            self.text = text

        async def stream(self):
            if "FAIL" in self.text:
                raise RuntimeError("service down")
            yield {"type": "WordBoundary"}
            yield {"type": "audio", "data": b"ID3fake-mp3-" + self.text.encode()}

    monkeypatch.setattr(edge_tts, "Communicate", FakeCommunicate)
    voice_tts._cache.clear()
    return calls


def test_tts_endpoint_returns_mp3_and_caches(client, fake_edge):
    r = client.get("/api/tts", params={"text": "Namaste, main Friday hoon."})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert r.content.startswith(b"ID3fake-mp3-")
    client.get("/api/tts", params={"text": "Namaste, main Friday hoon."})
    assert len(fake_edge) == 1  # second time from cache
    assert fake_edge[0][1] == "en-IN-NeerjaNeural"


def test_tts_endpoint_reports_failure_so_ui_can_fall_back(client, fake_edge):
    r = client.get("/api/tts", params={"text": "FAIL please"})
    assert r.status_code == 503 and "service down" in r.json()["error"]
    assert client.get("/api/voices").json()[0]["id"] == "en-IN-NeerjaNeural"
