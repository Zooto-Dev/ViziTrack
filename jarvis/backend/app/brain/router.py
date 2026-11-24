"""Fast intent router: Hindi / English / Hinglish commands without an LLM.

Short, unambiguous commands ("open chrome", "youtube kholo", "time kya hua",
"ruko") are matched here in well under a millisecond and executed directly.
Everything else goes to the LLM.  This is what keeps Jarvis responsive even
when no AI provider is configured, and it is deliberately conservative: when
in doubt it returns ``None`` and lets the model decide.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

Lang = Literal["hindi", "hinglish", "english"]

DEVANAGARI = re.compile(r"[ऀ-ॿ]")
HINGLISH_MARKERS = {
    "kya", "hai", "karo", "kar", "kholo", "khol", "batao", "bata", "mujhe", "mera", "mere", "meri", "ka", "ki",
    "ke", "nahi", "haan", "ruko", "chalo", "dikhao", "sunao", "yaad", "rakhna", "rakho", "bolo", "band", "kitna",
    "kaise", "kaun", "kahan", "abhi", "aaj", "kal", "samay", "bajaa", "baje", "chup", "bas", "thoda", "jaldi",
    "bhai", "yaar", "aur", "toh", "wala", "wali", "lagao", "chalao", "dhundo", "karna", "hoon", "hun", "tha", "thi",
    "raha", "rahi", "gaya", "gayi", "chahiye", "chahta", "chahti", "accha", "theek", "sab", "kuch", "koi",
}


def detect_language(text: str) -> Lang:
    if DEVANAGARI.search(text):
        return "hindi"
    words = re.findall(r"[a-z]+", text.lower())
    if not words:
        return "english"
    hits = sum(1 for w in words if w in HINGLISH_MARKERS)
    return "hinglish" if hits >= 1 and hits / len(words) >= 0.2 else "english"


@dataclass
class RouteMatch:
    intent: str  # "stop" | "tool"
    tool: str | None = None
    args: dict[str, Any] = field(default_factory=dict)
    lang: Lang = "english"


# Words that mean "open" in all three languages.
OPEN = r"(?:open|launch|start|run|kholo|khol|chalao|chalu|shuru|खोलो|खोल|चलाओ)"
OPEN_TAIL = r"(?:\s+(?:karo|kar|do|dijiye|kardo|please|na|zara|jara|toh|to|kro|करो|कर|दो))*"
POLITE = r"(?:please|jarvis|hey jarvis|ok jarvis|bhai|sir|ji|zara|jara|yaar|,|\.|!)"

STOP_RE = re.compile(
    r"^\s*(?:" + POLITE + r"\s*)*(?:stop|ruko|ruk|chup|bas|band karo|band kar|stop speaking|stop talking|"
    r"quiet|shut up|cancel|रुको|चुप|बस|बंद करो|hold on|wait)(?:\s+(?:speaking|talking|jarvis|karo|kar|ho|ja|jao|bolna|please))*\s*[.!]*\s*$",
    re.IGNORECASE,
)

TIME_RE = re.compile(
    r"(?:what(?:'s| is)? the time|what time is it|time (?:kya|kitna) (?:hua|hai|ho raha)|samay (?:kya|kitna)|"
    r"kitne baje|kya baj|current time|time batao|time bata|date (?:kya|batao|bata)|what(?:'s| is) (?:the|today's) date|"
    r"aaj (?:ki )?date|aaj kya (?:din|tareekh|date)|समय क्या|कितने बजे|कितना समय|आज की तारीख|क्या समय|टाइम क्या|टाइम बताओ|"
    r"क्या टाइम|टाइम कितना)",
    re.IGNORECASE,
)

STATUS_RE = re.compile(
    r"(?:system status|system ka status|system kaisa|pc status|computer status|cpu (?:usage|kitna|status|kaisa)|"
    r"ram (?:usage|kitni|kitna|status)|memory usage|performance (?:check|kaisa|dikhao)|how(?:'s| is) (?:my|the) (?:system|pc|computer)|"
    r"सिस्टम स्टेटस|सिस्टम का स्टेटस|सीपीयू)",
    re.IGNORECASE,
)

TASKS_RE = re.compile(
    r"(?:(?:my|mere|meri|pending|aaj ke|today'?s|baki|baaki|remaining)\s+(?:tasks?|kaam|todo|to-do|to do)|"
    r"(?:tasks?|kaam|todo)\s+(?:list|dikhao|batao|bata|kya hai|kya hain|pending|baki|baaki)|"
    r"what (?:tasks|do i have) (?:do i have )?(?:pending|left|today)?|kya kaam (?:baki|baaki|pending|hai)|"
    r"show (?:my )?tasks|list (?:my )?tasks|मेरे काम|काम क्या|मेरे टास्क|टास्क क्या|पेंडिंग टास्क|टास्क दिखाओ|टास्क बताओ)",
    re.IGNORECASE,
)

REMEMBER_RE = re.compile(
    r"^\s*(?:" + POLITE + r"\s*)*(?:remember(?: that| this)?|yaad rakhna|yaad rakho|yaad rakh|yaad rakh lo|note(?: this| down)?|"
    r"याद रखो|याद रखना|नोट करो)\s*[:,-]?\s*(?P<text>.{3,})$",
    re.IGNORECASE | re.DOTALL,
)
REMEMBER_SUFFIX_RE = re.compile(
    r"^\s*(?P<text>.{3,}?)\s*(?:yaad rakhna|yaad rakho|yaad rakh lo|yaad rakh|ye yaad rakhna|yeh yaad rakhna|याद रखो|याद रखना)\s*[.!]*\s*$",
    re.IGNORECASE | re.DOTALL,
)

ADD_TASK_RE = re.compile(
    r"^\s*(?:" + POLITE + r"\s*)*(?:add (?:a )?task|new task|task add karo|task banao|task likho|create (?:a )?task|"
    r"add to(?: my)? (?:todo|to-do|tasks?)|reminder (?:add|set) karo|टास्क जोड़ो)\s*[:,-]?\s*(?P<text>.{2,})$",
    re.IGNORECASE | re.DOTALL,
)

OPEN_RE = re.compile(
    r"^\s*(?:" + POLITE + r"\s*)*(?:(?:mujhe|mera|meri|zara|jara|ek baar)\s+)*" + OPEN +
    r"\s+(?P<target>.+?)" + OPEN_TAIL + r"\s*[.!]*\s*$",
    re.IGNORECASE,
)
OPEN_SUFFIX_RE = re.compile(
    r"^\s*(?:" + POLITE + r"\s*)*(?P<target>.+?)\s+" + OPEN + OPEN_TAIL + r"\s*[.!]*\s*$",
    re.IGNORECASE,
)

SEARCH_RE = re.compile(
    r"^\s*(?:" + POLITE + r"\s*)*(?:google karo|google par|google pe|search for|search karo|look up|google|search|dhundo|dhundho|खोजो|सर्च करो)"
    r"(?:\s+(?:for|karo|kar|par|pe|about|on))*\s+"
    r"(?P<query>.+?)(?:\s+(?:google|search|par|pe|karo|kar|do|dhundo|kro|ke baare me|ke bare me))*\s*[.!?]*\s*$",
    re.IGNORECASE,
)

_APP_WORDS = {
    "chrome", "edge", "firefox", "notepad", "calculator", "calc", "explorer", "file manager", "excel", "word",
    "powerpoint", "ppt", "outlook", "vs code", "vscode", "code", "terminal", "cmd", "powershell", "spotify",
    "whatsapp", "paint", "settings", "task manager", "camera", "telegram", "discord", "vlc", "browser",
}
_SITE_WORDS = {
    "youtube", "google", "gmail", "whatsapp web", "facebook", "instagram", "twitter", "x", "linkedin", "github",
    "chatgpt", "claude", "amazon", "flipkart", "netflix", "spotify web", "maps", "google maps", "drive", "google drive",
    "docs", "sheets", "calendar", "meet", "zoom", "stackoverflow", "reddit", "wikipedia",
}
_APP_NORMALISE = {"calc": "calculator", "ppt": "powerpoint", "browser": "chrome"}
# Devanagari spellings people actually use.
_DEVANAGARI_ALIASES = {
    "क्रोम": "chrome", "गूगल क्रोम": "chrome", "एज": "edge", "नोटपैड": "notepad", "कैलकुलेटर": "calculator",
    "एक्सेल": "excel", "वर्ड": "word", "पावरपॉइंट": "powerpoint", "व्हाट्सएप": "whatsapp", "व्हाट्सऐप": "whatsapp",
    "स्पॉटिफाई": "spotify", "कैमरा": "camera", "सेटिंग्स": "settings", "सेटिंग": "settings", "टर्मिनल": "terminal",
    "यूट्यूब": "youtube", "गूगल": "google", "जीमेल": "gmail", "फेसबुक": "facebook", "इंस्टाग्राम": "instagram",
    "ट्विटर": "twitter", "लिंक्डइन": "linkedin", "अमेज़न": "amazon", "अमेज़ॉन": "amazon", "फ्लिपकार्ट": "flipkart",
    "नेटफ्लिक्स": "netflix", "मैप्स": "maps", "गूगल मैप्स": "maps", "विकिपीडिया": "wikipedia", "ड्राइव": "drive",
}


def _clean_target(t: str) -> str:
    t = re.sub(r"^(?:the|a|an|mera|meri|mere|my)\s+", "", t.strip(), flags=re.IGNORECASE)
    t = re.sub(r"\s+(?:app|application|website|site|web|page|browser me|browser mein|me|mein)$", "", t, flags=re.IGNORECASE)
    return t.strip(" .!,")


def _open_route(target: str, lang: Lang) -> RouteMatch | None:
    t = _clean_target(target)
    t = _DEVANAGARI_ALIASES.get(t, t)
    low = t.lower()
    if not t or len(t) > 80:
        return None
    if low in _APP_WORDS:
        return RouteMatch("tool", "open_app", {"name": _APP_NORMALISE.get(low, low)}, lang)
    if low in _SITE_WORDS or low.startswith(("http://", "https://", "www.")) or re.fullmatch(r"[\w.-]+\.(com|in|org|net|io|ai|co|dev|app|edu|gov)(/\S*)?", low):
        return RouteMatch("tool", "open_website", {"target": t}, lang)
    return None  # unknown app/site: let the LLM decide (it may ask or search)


def route(text: str) -> RouteMatch | None:
    text = text.strip()
    if not text:
        return None
    lang = detect_language(text)

    if STOP_RE.match(text):
        return RouteMatch("stop", lang=lang)

    m = REMEMBER_RE.match(text) or REMEMBER_SUFFIX_RE.match(text)
    if m and not OPEN_RE.match(text):
        return RouteMatch("tool", "remember", {"text": m.group("text").strip(" .!")}, lang)

    m = ADD_TASK_RE.match(text)
    if m:
        return RouteMatch("tool", "add_task", {"title": m.group("text").strip(" .!")}, lang)

    if len(text) <= 60:
        if TIME_RE.search(text):
            return RouteMatch("tool", "get_time", {}, lang)
        if STATUS_RE.search(text):
            return RouteMatch("tool", "system_status", {}, lang)
        if TASKS_RE.search(text):
            return RouteMatch("tool", "list_tasks", {"status": "pending"}, lang)

    m = OPEN_RE.match(text)
    if m:
        r = _open_route(m.group("target"), lang)
        if r:
            return r
    m = OPEN_SUFFIX_RE.match(text)
    if m:
        r = _open_route(m.group("target"), lang)
        if r:
            return r

    m = SEARCH_RE.match(text)
    if m and len(text) <= 100:
        q = m.group("query").strip(" .!?")
        if q and not re.search(r"\b(?:file|files|folder|document|report|excel|pdf|desktop|downloads)\b", q, re.IGNORECASE):
            return RouteMatch("tool", "open_website", {"target": q}, lang)
    return None


def phrase_result(tool: str, ok: bool, message: str, data: dict[str, Any], lang: Lang, user_name: str) -> str:
    """Short natural reply for a directly-routed tool (no LLM involved)."""
    if not ok:
        return {
            "hindi": f"माफ़ कीजिए, यह नहीं हो सका: {message}",
            "hinglish": f"Sorry, yeh nahi ho paya: {message}",
            "english": f"Sorry, that didn't work: {message}",
        }[lang]
    if tool == "get_time":
        t, d = data.get("time", message), data.get("date", "")
        return {
            "hindi": f"अभी {t} बजे हैं, {d}।",
            "hinglish": f"Abhi {t} baje hain, {d}.",
            "english": f"It's {t}, {d}.",
        }[lang]
    if tool == "system_status":
        return {"hindi": f"सिस्टम स्थिति: {message}", "hinglish": f"System status: {message}", "english": f"System status: {message}"}[lang]
    if tool == "open_website":
        host = data.get("url", "").replace("https://", "").replace("http://", "").split("/")[0]
        return {"hindi": f"{host} खोल दिया।", "hinglish": f"{host} khol diya, {user_name}.", "english": f"Opening {host}, {user_name}."}[lang]
    if tool == "open_app":
        app = message.replace("launched ", "")
        return {"hindi": f"{app} खोल रहा हूँ।", "hinglish": f"{app} khol diya.", "english": f"Launching {app}."}[lang]
    if tool == "remember":
        return {"hindi": "ठीक है, याद रख लिया।", "hinglish": "Theek hai, yaad rakh liya.", "english": "Noted. I'll remember that."}[lang]
    if tool == "add_task":
        return {"hindi": "टास्क जोड़ दिया।", "hinglish": "Task add kar diya.", "english": "Task added."}[lang]
    if tool == "list_tasks":
        tasks = data.get("tasks", [])
        if not tasks:
            return {"hindi": "कोई पेंडिंग टास्क नहीं है।", "hinglish": "Koi pending task nahi hai.", "english": "You have no pending tasks."}[lang]
        head = {"hindi": f"आपके {len(tasks)} पेंडिंग टास्क:", "hinglish": f"Aapke {len(tasks)} pending tasks:", "english": f"You have {len(tasks)} pending tasks:"}[lang]
        return head + "\n" + "\n".join(f"{i + 1}. {t['title']}" for i, t in enumerate(tasks))
    return message
