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

/** Splits "hey friday chrome kholo" into (woke=true, rest="chrome kholo"). */
function splitWake(text: string): { woke: boolean; rest: string } {
  const m = text.match(wakeRegex(useStore.getState().settings?.assistant_name || 'friday'))
  if (!m) return { woke: false, rest: text.trim() }
  const rest = text.slice((m.index ?? 0) + m[0].length).replace(/^[\s,.!?]+/, '').trim()
  return { woke: true, rest }
}

const hasWords = (s: string) => /[\p{L}\p{N}]{2,}/u.test(s)

function selfEcho(): boolean {
  return useStore.getState().speaking || Date.now() - speaker.lastEnded < ECHO_GRACE_MS
}

/** Partial words: wake up the moment "Friday" is heard instead of waiting for the sentence to end. */
function onInterim(raw: string) {
  const st = useStore.getState()
  if (armedUntil > Date.now()) {
    st.setWakeHeard(raw)
    return
  }
  if (selfEcho()) return
  const { woke, rest } = splitWake(raw)
  if (woke && !hasWords(rest)) {
    chime()
    setArmed(true)
  }
}

function onFinal(raw: string) {
  const text = raw.trim()
  if (!text) return
  const st = useStore.getState()
  st.setWakeHeard(text)
  // While she talks (and just after), accept only "stop" so she ignores her own voice.
  if (selfEcho()) {
    if (st.speaking && STOP_RE.test(text)) api.chat('ruko')
    return
  }
  const { woke, rest } = splitWake(text)
  if (armedUntil > Date.now()) {
    const cmd = woke ? rest : text
    if (!hasWords(cmd)) return // just the wake word again: keep waiting for the command
    setArmed(false)
    api.chat(cmd)
    return
  }
  if (!woke) return
  if (hasWords(rest)) {
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
  r.interimResults = true
  r.maxAlternatives = 1
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) onFinal(t)
      else onInterim(t)
    }
  }
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      useStore.getState().showToast('Wake word ke liye mic ki permission chahiye. Window ke upar mic icon se Allow karein.')
      setWakeEnabled(false)
    } else if (e.error === 'network') {
      backoff = Math.min(15000, backoff * 2)
      useStore.getState().setWakeStatus('no-internet')
    } else if (e.error === 'audio-capture') {
      useStore.getState().setWakeStatus('no-mic')
    }
  }
  r.onend = () => {
    if (rec === r) rec = null
    // Browsers end continuous recognition every minute or so; keep it going.
    if (enabled && !paused) {
      if (useStore.getState().wakeStatus === 'listening') useStore.getState().setWakeStatus('restarting')
      window.clearTimeout(restartTimer)
      restartTimer = window.setTimeout(startRec, backoff)
    }
  }
  rec = r
  try {
    r.start()
    backoff = 300
    useStore.getState().setWakeStatus('listening')
  } catch {
    rec = null
    useStore.getState().setWakeStatus('restarting')
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
    useStore.getState().setWakeStatus('off')
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
