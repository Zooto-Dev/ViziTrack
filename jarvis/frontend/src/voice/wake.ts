/**
 * Wake word: listens all the time (only while the user has switched it on)
 * and reacts to "Friday", "Hey Friday" or "Wake up".
 *
 *   "Hey Friday"                 -> chime, then the next sentence is the command
 *   "Hey Friday, chrome kholo"   -> runs "chrome kholo" straight away
 *   "Friday stop" / "ruko"       -> stops her while she is speaking
 *
 * Uses the browser's speech recognizer in continuous mode, which needs an
 * internet connection. While FRIDAY is talking, only stop words are accepted
 * so she does not react to her own voice.
 */
import { useStore } from '../store'
import { api } from '../ws'
import { speaker } from './tts'

interface Result {
  isFinal: boolean
  0: { transcript: string }
}
interface Rec {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: { resultIndex: number; results: ArrayLike<Result> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecCtor = new () => Rec

const Ctor: RecCtor | undefined =
  typeof window !== 'undefined'
    ? ((window as unknown as Record<string, RecCtor | undefined>).SpeechRecognition ??
      (window as unknown as Record<string, RecCtor | undefined>).webkitSpeechRecognition)
    : undefined

export const wakeSupported = !!Ctor

const COMMAND_WINDOW_MS = 8000
const ECHO_GRACE_MS = 1200
const STOP_RE = /^\s*(?:(?:hey\s+)?friday[\s,]*)?(stop|ruko|ruk jao|bas|chup|band karo|cancel|रुको|बस|चुप)\b/i

function wakeRegex(name: string): RegExp {
  const n = name.trim().toLowerCase().replace(/[^a-zऀ-ॿ ]/g, '') || 'friday'
  const names = [n, 'friday', 'fraide', 'फ्राइडे', 'फ्राईडे'].map((x) => x.replace(/\s+/g, '\\s*'))
  return new RegExp(
    `(?:^|\\s)(?:(?:hey|hi|ok|okay|हे|हाय)\\s+)?(?:${names.join('|')})(?=$|[\\s,.!?])|wake\\s*up|वेक\\s*अप|uth\\s*jao|उठ\\s*जाओ`,
    'i',
  )
}

let rec: Rec | null = null
let enabled = false
let paused = false
let armedUntil = 0
let restartTimer: number | undefined
let backoff = 300
let audio: AudioContext | null = null

function chime() {
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    for (const [i, f] of [660, 990].entries()) {
      const o = audio.createOscillator()
      const g = audio.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + i * 0.09)
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.09 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.16)
      o.connect(g).connect(audio.destination)
      o.start(t + i * 0.09)
      o.stop(t + i * 0.09 + 0.18)
    }
  } catch {
    /* sound is optional */
  }
}

function setArmed(on: boolean) {
  armedUntil = on ? Date.now() + COMMAND_WINDOW_MS : 0
  useStore.getState().setWakeArmed(on)
  if (on) {
    window.setTimeout(() => {
      if (armedUntil && Date.now() >= armedUntil) setArmed(false)
    }, COMMAND_WINDOW_MS + 50)
  }
}

function onFinal(raw: string) {
  const text = raw.trim()
  if (!text) return
  const st = useStore.getState()
  // While she talks (and just after), accept only "stop" so she ignores her own voice.
  if (st.speaking || Date.now() - speaker.lastEnded < ECHO_GRACE_MS) {
    if (st.speaking && STOP_RE.test(text)) api.chat('ruko')
    return
  }
  if (armedUntil > Date.now()) {
    setArmed(false)
    api.chat(text)
    return
  }
  const m = text.match(wakeRegex(st.settings?.assistant_name || 'friday'))
  if (!m) return
  const rest = text.slice((m.index ?? 0) + m[0].length).replace(/^[\s,.!?]+/, '')
  if (/[\p{L}\p{N}]{2,}/u.test(rest)) {
    api.chat(rest)
  } else {
    chime()
    setArmed(true)
  }
}

function startRec() {
  if (!Ctor || !enabled || paused || rec) return
  const r = new Ctor()
  r.lang = useStore.getState().settings?.voice?.stt_lang || 'en-IN'
  r.continuous = true
  r.interimResults = false
  r.maxAlternatives = 1
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) onFinal(e.results[i][0].transcript)
    }
  }
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      useStore.getState().showToast('Wake word ke liye mic ki permission chahiye. Window ke upar mic icon se Allow karein.')
      setWakeEnabled(false)
    } else if (e.error === 'network') {
      backoff = Math.min(15000, backoff * 2)
    }
  }
  r.onend = () => {
    if (rec === r) rec = null
    // Browsers end continuous recognition every minute or so; keep it going.
    if (enabled && !paused) {
      window.clearTimeout(restartTimer)
      restartTimer = window.setTimeout(startRec, backoff)
    }
  }
  rec = r
  try {
    r.start()
    backoff = 300
  } catch {
    rec = null
  }
}

function stopRec() {
  window.clearTimeout(restartTimer)
  const r = rec
  rec = null
  try {
    r?.abort()
  } catch {
    /* already stopped */
  }
}

/** Turn always-on listening on or off (called from settings). */
export function setWakeEnabled(on: boolean) {
  if (on === enabled) return
  enabled = on
  useStore.getState().setWakeOn(on)
  if (on) startRec()
  else {
    setArmed(false)
    stopRec()
  }
}

/** The push-to-talk mic needs the recognizer to itself. */
export function pauseWake() {
  paused = true
  setArmed(false)
  stopRec()
}

export function resumeWake() {
  paused = false
  if (enabled) window.setTimeout(startRec, 250)
}
