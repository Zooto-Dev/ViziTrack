# F.R.I.D.A.Y. — Personal AI Assistant

Iron Man ki FRIDAY jaisi personal AI assistant jo aapke computer par chalti hai. Hindi / English / Hinglish samajhti hai, bol kar jawab deti hai, "Friday" bolne par jaag jaati hai, aur sirf baat nahi karti: **kaam karti hai** (apps aur files kholna, Excel/PDF padhna, code likhna, yaad rakhna, tasks sambhalna).

**Koi paid API key zaroori nahi.** Default AI = [Ollama](https://ollama.com) (free, offline). Tez jawab ke liye free Groq key Settings me lagao.

> Folder ka naam `jarvis` hi rakha hai taaki purane install, settings aur yaadein update ke baad bhi bani rahein.

## 1. Setup (Windows, beginner-friendly)

Teen cheezein install karni hain. Sab free hain.

### Step 1 — Python
1. https://www.python.org/downloads/ se latest Python 3 download karo.
2. Installer me **"Add python.exe to PATH"** ka checkbox zaroor tick karo, phir Install Now.

### Step 2 — Node.js (optional)
UI pehle se build hokar aata hai (`frontend/dist`), isliye Node.js ki zaroorat sirf tab hai jab aap UI ka code badalna chaho.

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
   aur FRIDAY ki Settings me Model = `qwen2.5:3b` set karo.

### Step 4 — FRIDAY start
1. Is `jarvis` folder me `start.bat` par double-click karo.
2. Pehli baar 2–3 minute lagenge (packages install). Is dauran kali window ke andar click mat karna, warna Windows use pause kar deta hai. Phir se chalane par turant khulega.
3. FRIDAY ki window khul jayegi (Edge/Chrome app mode me). Agar nahi khule toh browser me `http://127.0.0.1:8765` kholo.
4. Settings (⚙) → **Test connection** dabao. Green "Ollama ready" dikhna chahiye.

### macOS / Linux
Same steps; `start.bat` ki jagah terminal me:
```bash
chmod +x start.sh && ./start.sh
```

---

## 2. Voice se kaise chalayein

1. FRIDAY window me neeche **mic button** (🎤) dabao, ya keyboard par **Ctrl + Space**.
2. Pehli baar window poochegi "Use your microphone?". **Allow** dabao.
3. Boliye, jaise "chrome kholo". Bolna band karte hi command chali jayegi.
4. FRIDAY jawab bol kar sunayegi. Beech me rokna ho toh mic dabakar "ruko" boliye, ya **STOP** dabaiye.

Mic ke liye internet chahiye (awaaz Microsoft/Google pehchante hain, free). Awaaz, speed aur bhasha Settings → Voice me badal sakte ho.

**Speed ke baare me sach:** "chrome kholo", "time kya hua", "youtube kholo", "yaad rakhna…", "mere tasks" jaise commands AI ke bina turant chalte hain. Aam sawaalon ka jawab AI model deta hai. Ollama aapke PC ke CPU par chalta hai, toh purane ya bina graphics card wale PC par 10–60 second lag sakte hain (pehla jawab sabse slow). Tez jawab chahiye toh Settings me **Groq** chuno (free key, jawab ~1 second me).

### Wake word: "Friday" bolkar jagao
1. Upar right me **WAKE OFF** button dabao. Wo **WAKE ON** ho jayega (ya Settings → Voice me checkbox).
2. Ab bas boliye **"Friday"**, **"Hey Friday"** ya **"Wake up"**. Ek chhoti si "ting" aayegi, phir apni command boliye.
3. Ek saans me bhi bol sakte ho: **"Hey Friday, chrome kholo"**.
4. Wo bol rahi ho toh **"Friday stop"** ya **"ruko"** boliye.

Wake word on ho toh mic lagataar sunta hai, sirf jab tak FRIDAY ki window khuli hai. Iske liye internet chahiye. Band karna ho toh wahi button dobara dabao.

## 3. Kya bol sakte ho

| Aap bologe / likhoge | FRIDAY karegi |
|---|---|
| `open chrome` / `chrome kholo` / `क्रोम खोलो` | Chrome launch (koi bhi app: excel, notepad, calculator, vs code, whatsapp, spotify…) |
| `youtube khol do` / `open gmail` / `open github.com` | Default browser me site kholta hai |
| `google karo weather in delhi` / `search for best laptops` | Google search kholta hai |
| `time kya hua` / `what time is it` | Local time + date |
| `system status` / `cpu kitna use ho raha hai` | Live CPU / RAM |
| `yaad rakhna meri meeting 5 baje hai` / `remember my car number is DL8C1234` | Long-term memory me save |
| `what do you remember about me?` | Memory se recall (AI ke through) |
| `add task send GST report` / `mere pending tasks` | Task manager |
| `meri latest excel file kholo` / `last pdf kholo` / `latest excel gst report kholo` | Sabse nayi file dhoondh kar Excel/PDF viewer me kholta hai (turant, bina AI) |
| `GST wali excel file dhundo` | Desktop, Documents, Downloads, OneDrive aur D:/E: drive me dhoondhta hai |
| `is file ka summary do` / `sales.xlsx me November ka total kya hai` | Excel, PDF, Word, text file padh kar jawab deta hai |
| `ek python script likho jo folder ki saari files ka naam list kare` | Code likh kar `Documents\FRIDAY` me save karta hai aur VS Code/Notepad me kholta hai |
| `stop` / `ruko` / `chup` | Jo chal raha hai use rokta hai |
| Koi bhi sawaal, Hindi/English/Hinglish me | AI provider se jawab (streaming) |

Simple commands **AI ke bina** turant chalte hain (≈30 ms). Baaki sab AI ke paas jaata hai, jo zaroorat par tools (open_app, remember, add_task…) khud call karta hai.

Destructive actions (delete, forget) hamesha pehle **confirm** maangte hain. Settings me "Ask before every system action" on karoge toh app/website kholne se pehle bhi poochega.

---

## 4. AI provider options (Settings → AI Provider)

| Provider | Cost | Key chahiye? | Notes |
|---|---|---|---|
| **Ollama** (default) | Free, offline | Nahi | `qwen2.5:7b` recommended (Hinglish + tools dono accha). 8 GB+ RAM. |
| Groq | Free tier | Haan (free, console.groq.com) | Bahut fast. Internet chahiye. |
| Google Gemini | Free tier | Haan (free, aistudio.google.com) | Internet chahiye. |
| OpenRouter | Free models available | Haan (openrouter.ai) | Model name `:free` wale choose karo. |
| OpenAI-compatible | — | Optional | LM Studio, vLLM, etc. |
| Anthropic Claude | Paid | Haan | Best quality; `claude-opus-5-5` default. Pehle `backend\.venv\Scripts\pip install anthropic` chalao. |

API keys sirf backend me store hoti hain (`backend/data/settings.json`, git me nahi jaata). UI ko kabhi real key nahi bheji jaati.

---

## 5. Feature status

**Done (tested)**
- [x] Phase 1 — Core app: FastAPI backend + WebSocket, React HUD (reactor, waveform ring, live CPU/RAM/NET, conversation, quick actions, settings)
- [x] Phase 2 — Text AI conversation: streaming replies, tool calling, providers (Ollama, Groq, Gemini, OpenRouter, OpenAI-compatible, Anthropic)
- [x] Fast intent router (Hindi / English / Hinglish) — commands bina AI ke turant
- [x] Tools: open_app, open_website, get_time, system_status, remember / recall / forget, add_task / list_tasks / complete_task / delete_task
- [x] Long-term memory + tasks (SQLite), conversation history persists across restarts
- [x] Confirmation gate for risky actions; interrupt/stop
- [x] Honest execution: failures are shown as failures, never faked

**Pending**
- [x] Phase 3 (pehla version) — Voice: mic button / Ctrl+Space, Hindi + English + Hinglish pehchaan, jawab bol kar sunana (sentence by sentence, streaming ke saath), awaaz chunna, "ruko"/STOP se turant chup
- [x] Speed: model FRIDAY start hote hi load ho jata hai aur 60 minute tak memory me rehta hai; chhota stable prompt jise Ollama cache karta hai; "Soch raha hoon… Ns" timer
- [ ] Offline voice (faster-whisper + Piper) taaki mic bina internet ke chale
- [x] Phase 4 — Wake word "Friday" / "Hey Friday" / "Wake up", apni awaaz par nahi jaagti, "Friday stop" se rukti hai
- [ ] Offline wake word (bina internet, PC par hi)
- [ ] Phase 5 — Smarter memory (auto-extract facts, semantic recall)
- [x] Phase 6 (pehla hissa) — Files: dhoondhna, kholna, latest file kholna, Excel/PDF/Word padhna, code/letter likh kar save karna
  - Safety: programs (.exe, .bat…) kabhi nahi chalata; code files editor me khulti hain, chalti nahi; FRIDAY folder ke bahar likhna ya purani file badalna ho toh pehle poochta hai
- [ ] Phase 6 (baaki) — screenshots, volume, window control
- [ ] Phase 7 — Automation workflows, web search + summarise, integrations
- [ ] Phase 8 — Packaging (Tauri installer), performance & security hardening

---

## 6. Developer notes

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
