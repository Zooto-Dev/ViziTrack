# J.A.R.V.I.S. — Personal AI Assistant

Iron Man style personal AI assistant jo aapke computer par chalta hai. Voice-first (aane wala hai), text-first abhi, Hindi / English / Hinglish samajhta hai, aur sirf baat nahi karta: **kaam karta hai** (apps kholna, websites kholna, yaad rakhna, tasks sambhalna).

**Koi paid API key zaroori nahi.** Default AI brain = [Ollama](https://ollama.com) (free, offline, aapke PC par chalta hai). Free-tier online options (Groq, Gemini, OpenRouter) bhi Settings me hain.

---

## 1. Setup (Windows, beginner-friendly)

Teen cheezein install karni hain. Sab free hain.

### Step 1 — Python
1. https://www.python.org/downloads/ se latest Python 3 download karo.
2. Installer me **"Add python.exe to PATH"** ka checkbox zaroor tick karo, phir Install Now.

### Step 2 — Node.js (sirf UI build ke liye, ek baar)
1. https://nodejs.org/ se **LTS** version download karke install karo (sab default rakho).

### Step 3 — Ollama (free AI brain)
1. https://ollama.com/download se Ollama install karo.
2. Start menu se **Ollama** open karo (ye background me chalta rahega, taskbar me icon dikhega).
3. `Win + R` dabao, `cmd` likho, Enter. Phir ye command chalao (model ek baar download hoga, ~4.7 GB):
   ```bash
   ollama pull qwen2.5:7b
   ```
   PC me 8 GB se kam RAM hai? Toh chhota model lo (~2 GB):
   ```bash
   ollama pull qwen2.5:3b
   ```
   aur Jarvis ki Settings me Model = `qwen2.5:3b` set karo.

### Step 4 — Jarvis start
1. Is `jarvis` folder me `start.bat` par double-click karo.
2. Pehli baar 2–5 minute lagenge (packages install + UI build). Phir se chalane par turant khulega.
3. Jarvis ki window khul jayegi (Chrome/Edge app mode me). Agar nahi khule toh browser me `http://127.0.0.1:8765` kholo.
4. Settings (⚙) → **Test connection** dabao. Green "Ollama ready" dikhna chahiye.

### macOS / Linux
Same steps; `start.bat` ki jagah terminal me:
```bash
chmod +x start.sh && ./start.sh
```

---

## 2. Kya bol sakte ho (abhi, text me)

| Aap likhoge | Jarvis karega |
|---|---|
| `open chrome` / `chrome kholo` / `क्रोम खोलो` | Chrome launch (koi bhi app: excel, notepad, calculator, vs code, whatsapp, spotify…) |
| `youtube khol do` / `open gmail` / `open github.com` | Default browser me site kholta hai |
| `google karo weather in delhi` / `search for best laptops` | Google search kholta hai |
| `time kya hua` / `what time is it` | Local time + date |
| `system status` / `cpu kitna use ho raha hai` | Live CPU / RAM |
| `yaad rakhna meri meeting 5 baje hai` / `remember my car number is DL8C1234` | Long-term memory me save |
| `what do you remember about me?` | Memory se recall (AI ke through) |
| `add task send GST report` / `mere pending tasks` | Task manager |
| `stop` / `ruko` / `chup` | Jo chal raha hai use rokta hai |
| Koi bhi sawaal, Hindi/English/Hinglish me | AI provider se jawab (streaming) |

Simple commands **AI ke bina** turant chalte hain (≈30 ms). Baaki sab AI ke paas jaata hai, jo zaroorat par tools (open_app, remember, add_task…) khud call karta hai.

Destructive actions (delete, forget) hamesha pehle **confirm** maangte hain. Settings me "Ask before every system action" on karoge toh app/website kholne se pehle bhi poochega.

---

## 3. AI provider options (Settings → AI Provider)

| Provider | Cost | Key chahiye? | Notes |
|---|---|---|---|
| **Ollama** (default) | Free, offline | Nahi | `qwen2.5:7b` recommended (Hinglish + tools dono accha). 8 GB+ RAM. |
| Groq | Free tier | Haan (free, console.groq.com) | Bahut fast. Internet chahiye. |
| Google Gemini | Free tier | Haan (free, aistudio.google.com) | Internet chahiye. |
| OpenRouter | Free models available | Haan (openrouter.ai) | Model name `:free` wale choose karo. |
| OpenAI-compatible | — | Optional | LM Studio, vLLM, etc. |
| Anthropic Claude | Paid | Haan | Best quality; `claude-opus-5-5` default. |

API keys sirf backend me store hoti hain (`backend/data/settings.json`, git me nahi jaata). UI ko kabhi real key nahi bheji jaati.

---

## 4. Feature status

**Done (tested)**
- [x] Phase 1 — Core app: FastAPI backend + WebSocket, React HUD (reactor, waveform ring, live CPU/RAM/NET, conversation, quick actions, settings)
- [x] Phase 2 — Text AI conversation: streaming replies, tool calling, providers (Ollama, Groq, Gemini, OpenRouter, OpenAI-compatible, Anthropic)
- [x] Fast intent router (Hindi / English / Hinglish) — commands bina AI ke turant
- [x] Tools: open_app, open_website, get_time, system_status, remember / recall / forget, add_task / list_tasks / complete_task / delete_task
- [x] Long-term memory + tasks (SQLite), conversation history persists across restarts
- [x] Confirmation gate for risky actions; interrupt/stop
- [x] Honest execution: failures are shown as failures, never faked

**Pending**
- [ ] Phase 3 — Voice: speech-to-text (faster-whisper, local), text-to-speech (edge-tts / Piper), mic controls
- [ ] Phase 4 — Wake word "Hey Jarvis" (openWakeWord), barge-in interruption
- [ ] Phase 5 — Smarter memory (auto-extract facts, semantic recall)
- [ ] Phase 6 — Desktop control: file search, document summarise, screenshots, volume, window control
- [ ] Phase 7 — Automation workflows, web search + summarise, integrations
- [ ] Phase 8 — Packaging (Tauri installer), performance & security hardening

---

## 5. Developer notes

```
jarvis/
  backend/            Python 3.11+ (FastAPI)
    app/main.py       REST + WebSocket protocol, sessions
    app/brain/        router.py (fast intents), agent.py (tool loop), prompts.py, providers/
    app/tools/        registry.py (schema + risk + executor), builtin.py
    app/memory/       SQLite store (memories, tasks, conversations)
    app/monitor.py    psutil telemetry (1 Hz, only while a UI is connected)
    dev/mock_provider.py   fake LLM (OpenAI + Ollama protocols) for tests/dev
    tests/            pytest (router, store, tools, WebSocket end-to-end)
  frontend/           React 19 + Vite + TypeScript + Zustand (no UI framework)
    src/components/Reactor.tsx   Canvas 2D visualisation, zero React re-renders
    src/ws.ts         WebSocket client with reconnect
```

Run tests:
```bash
cd backend && .venv/bin/python -m pytest -q
```

Dev mode (hot reload): backend `JARVIS_RELOAD=1 python run.py`, frontend `npm run dev` (proxies to :8765).

Try the UI without any model: `python -m dev.mock_provider` (listens on :11434 like Ollama) and set Model = `mock-model`.

Performance budget: UI bundle ≈ 72 KB gzipped; direct commands ≈ 30 ms end-to-end; idle CPU from the reactor < 1% (throttled to 20 fps when idle).
