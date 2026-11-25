"""Neural text-to-speech for FRIDAY's replies.

Uses Microsoft's neural voices through the free ``edge-tts`` service (the same
voices Edge's read-aloud uses), so the voice is smooth and identical in every
browser. One request per sentence keeps the first word fast; the browser
fetches the next sentence while the current one plays.

This service is not an official API. If it fails (no internet, service
change), the endpoint returns an error and the UI falls back to the
browser's own voices.
"""

from __future__ import annotations

import re
from collections import OrderedDict

DEVANAGARI = re.compile(r"[ऀ-ॿ]")

# Voices offered in Settings: (id, label). Female voices first: FRIDAY is a woman.
NEURAL_VOICES: list[tuple[str, str]] = [
    ("en-IN-NeerjaNeural", "Neerja · Indian English (mahila)"),
    ("en-IN-NeerjaExpressiveNeural", "Neerja Expressive · zyada bhaav (mahila)"),
    ("hi-IN-SwaraNeural", "Swara · Hindi (mahila)"),
    ("en-IN-PrabhatNeural", "Prabhat · Indian English (purush)"),
    ("hi-IN-MadhurNeural", "Madhur · Hindi (purush)"),
]
HINDI_FOR = {
    "en-IN-NeerjaNeural": "hi-IN-SwaraNeural",
    "en-IN-NeerjaExpressiveNeural": "hi-IN-SwaraNeural",
    "en-IN-PrabhatNeural": "hi-IN-MadhurNeural",
}

_cache: OrderedDict[tuple[str, str, str], bytes] = OrderedDict()
CACHE_ITEMS = 200


class TTSUnavailable(RuntimeError):
    pass


def pick_voice(text: str, preferred: str) -> str:
    """Devanagari text needs a Hindi voice; Latin Hinglish/English reads best in Indian English."""
    voice = preferred if preferred in dict(NEURAL_VOICES) else NEURAL_VOICES[0][0]
    if DEVANAGARI.search(text):
        return HINDI_FOR.get(voice, voice)
    return voice


def rate_str(rate: float) -> str:
    pct = round((max(0.5, min(2.0, rate)) - 1) * 100)
    return f"{pct:+d}%"


def clean(text: str) -> str:
    text = re.sub(r"https?://\S+", "link", text)
    text = re.sub(r"[*_#`>|~]", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:600]


async def synthesize(text: str, preferred_voice: str, rate: float) -> bytes:
    """MP3 bytes for ``text``. Raises TTSUnavailable when the service cannot be used."""
    text = clean(text)
    if not text:
        raise TTSUnavailable("empty text")
    voice = pick_voice(text, preferred_voice)
    key = (text, voice, rate_str(rate))
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    try:
        import edge_tts
    except ImportError as e:  # pragma: no cover - depends on install
        raise TTSUnavailable("edge-tts is not installed") from e
    audio = bytearray()
    try:
        com = edge_tts.Communicate(text, voice, rate=key[2], connect_timeout=6, receive_timeout=20)
        async for chunk in com.stream():
            if chunk.get("type") == "audio" and chunk.get("data"):
                audio.extend(chunk["data"])
    except Exception as e:  # noqa: BLE001 - network, service changes, bad voice
        raise TTSUnavailable(f"{type(e).__name__}: {e}") from e
    if not audio:
        raise TTSUnavailable("no audio received")
    data = bytes(audio)
    _cache[key] = data
    if len(_cache) > CACHE_ITEMS:
        _cache.popitem(last=False)
    return data
