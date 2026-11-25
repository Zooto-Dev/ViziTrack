"""Start the Jarvis backend: ``python run.py`` (host/port via env JARVIS_HOST/JARVIS_PORT)."""

import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("JARVIS_HOST", "127.0.0.1"),
        port=int(os.environ.get("JARVIS_PORT", "8765")),
        reload=os.environ.get("JARVIS_RELOAD") == "1",
        log_level="info",
    )
