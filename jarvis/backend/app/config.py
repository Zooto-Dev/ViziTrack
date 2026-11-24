"""Persistent settings.

Settings live in ``data/settings.json`` next to the backend (never in the
frontend).  API keys are stored here too and are only ever sent to the
frontend in masked form.  Environment variables (``.env``) override the
file for keys, so power users can keep secrets out of the JSON entirely.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("JARVIS_DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE = DATA_DIR / "settings.json"

ProviderName = Literal["ollama", "groq", "gemini", "openrouter", "openai_compat", "anthropic"]

# Sensible defaults per provider so a beginner only has to paste a key.
PROVIDER_PRESETS: dict[str, dict[str, Any]] = {
    "ollama": {
        "label": "Ollama (local, free, no key)",
        "base_url": "http://127.0.0.1:11434",
        "model": "qwen2.5:7b",
        "needs_key": False,
        "kind": "ollama",
    },
    "groq": {
        "label": "Groq (free tier, needs free key)",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "openai/gpt-oss-120b",
        "needs_key": True,
        "kind": "openai_compat",
    },
    "gemini": {
        "label": "Google Gemini (free tier, needs free key)",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-2.0-flash",
        "needs_key": True,
        "kind": "openai_compat",
    },
    "openrouter": {
        "label": "OpenRouter (has free models, needs key)",
        "base_url": "https://openrouter.ai/api/v1",
        "model": "meta-llama/llama-3.3-70b-instruct:free",
        "needs_key": True,
        "kind": "openai_compat",
    },
    "openai_compat": {
        "label": "Any OpenAI-compatible server (LM Studio, vLLM, ...)",
        "base_url": "http://127.0.0.1:1234/v1",
        "model": "",
        "needs_key": False,
        "kind": "openai_compat",
    },
    "anthropic": {
        "label": "Anthropic Claude (paid key)",
        "base_url": "",
        "model": "claude-opus-5-5",
        "needs_key": True,
        "kind": "anthropic",
    },
}


class ProviderSettings(BaseModel):
    name: ProviderName = "ollama"
    base_url: str = PROVIDER_PRESETS["ollama"]["base_url"]
    model: str = PROVIDER_PRESETS["ollama"]["model"]
    api_key: str = ""
    # Soft ceiling for one reply; keeps voice answers short and fast.
    max_tokens: int = 1024
    timeout_s: float = 120.0


class VoiceSettings(BaseModel):
    speak_replies: bool = True
    tts_voice: str = ""  # browser voice name; empty = pick the best automatically
    tts_rate: float = 1.05
    stt_lang: str = "en-IN"  # en-IN understands English + Hinglish; hi-IN for pure Hindi
    wake_word: str = "friday"
    # Always-on listening for the wake word (the user asked for it to be on by default).
    wake_enabled: bool = True
    # natural = online human-like voices (Edge), fast = offline voices, instant
    tts_mode: str = "natural"


class Settings(BaseModel):
    user_name: str = "Sir"
    assistant_name: str = "Friday"
    # auto = mirror the user's language (Hindi / English / Hinglish)
    reply_language: Literal["auto", "english", "hindi", "hinglish"] = "auto"
    provider: ProviderSettings = Field(default_factory=ProviderSettings)
    voice: VoiceSettings = Field(default_factory=VoiceSettings)
    # Tools with risk "confirm" always ask; this lets the user also require
    # confirmation for everything that touches the system.
    confirm_all_system_actions: bool = False
    history_limit: int = 40
    settings_version: int = 3


_lock = threading.Lock()
_settings: Settings | None = None


def _env_key_for(provider: str) -> str:
    env_names = {
        "groq": "GROQ_API_KEY",
        "gemini": "GEMINI_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
        "openai_compat": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
    }
    return os.environ.get(env_names.get(provider, ""), "")


def load_settings() -> Settings:
    global _settings
    with _lock:
        if _settings is not None:
            return _settings
        if SETTINGS_FILE.exists():
            try:
                raw = json.loads(SETTINGS_FILE.read_text("utf-8"))
                version = raw.get("settings_version", 1)
                if version < 2:
                    # v2: the assistant was renamed from Jarvis to Friday.
                    if raw.get("assistant_name") in (None, "Jarvis"):
                        raw["assistant_name"] = "Friday"
                    raw.setdefault("voice", {})["wake_word"] = "friday"
                if version < 3:
                    # v3: wake word listens by default.
                    raw.setdefault("voice", {})["wake_enabled"] = True
                if version < 3:
                    raw["settings_version"] = 3
                    SETTINGS_FILE.write_text(json.dumps(raw, indent=2), "utf-8")
                _settings = Settings.model_validate(raw)
            except Exception:  # corrupt file: start fresh, keep a backup
                SETTINGS_FILE.rename(SETTINGS_FILE.with_suffix(".bad.json"))
                _settings = Settings()
        else:
            _settings = Settings()
        return _settings


def save_settings(settings: Settings) -> None:
    global _settings
    with _lock:
        _settings = settings
        tmp = SETTINGS_FILE.with_suffix(".tmp")
        tmp.write_text(settings.model_dump_json(indent=2), "utf-8")
        tmp.replace(SETTINGS_FILE)


def update_settings(patch: dict[str, Any]) -> Settings:
    """Deep-merge ``patch`` into the current settings and persist."""
    current = load_settings().model_dump()

    def merge(dst: dict[str, Any], src: dict[str, Any]) -> None:
        for k, v in src.items():
            if isinstance(v, dict) and isinstance(dst.get(k), dict):
                merge(dst[k], v)
            else:
                dst[k] = v

    merge(current, patch)
    # Switching provider: fill in that provider's preset for empty fields.
    prov = current.get("provider", {})
    preset = PROVIDER_PRESETS.get(prov.get("name", ""), None)
    if preset:
        if not prov.get("base_url"):
            prov["base_url"] = preset["base_url"]
        if not prov.get("model"):
            prov["model"] = preset["model"]
    new = Settings.model_validate(current)
    save_settings(new)
    return new


def effective_api_key(settings: Settings | None = None) -> str:
    s = settings or load_settings()
    return _env_key_for(s.provider.name) or s.provider.api_key


def public_settings(settings: Settings | None = None) -> dict[str, Any]:
    """Settings as sent to the UI: key masked, never the real value."""
    s = settings or load_settings()
    d = s.model_dump()
    key = effective_api_key(s)
    d["provider"]["api_key"] = ("•" * 8 + key[-4:]) if key else ""
    d["provider"]["has_key"] = bool(key)
    d["provider_presets"] = PROVIDER_PRESETS
    return d
