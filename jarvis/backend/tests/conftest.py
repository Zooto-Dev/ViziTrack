from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Must happen before any app module is imported (test modules import them at
# collection time), so tests never touch the real backend/data settings.
_DATA = tempfile.mkdtemp(prefix="jarvis-test-data-")
os.environ["JARVIS_DATA_DIR"] = _DATA
os.environ.setdefault("JARVIS_WORKSPACE", str(Path(_DATA) / "workspace"))


@pytest.fixture()
def mock_llm(monkeypatch: pytest.MonkeyPatch):
    """Route every provider HTTP call to the in-process mock LLM via ASGI."""
    import httpx

    from dev.mock_provider import app as mock_app

    real_client = httpx.AsyncClient

    def patched(*args, **kwargs):
        kwargs["transport"] = httpx.ASGITransport(app=mock_app)
        return real_client(*args, **kwargs)

    import app.brain.providers.ollama as ollama_mod
    import app.brain.providers.openai_compat as oa_mod

    monkeypatch.setattr(oa_mod.httpx, "AsyncClient", patched)
    monkeypatch.setattr(ollama_mod.httpx, "AsyncClient", patched)
    return mock_app
