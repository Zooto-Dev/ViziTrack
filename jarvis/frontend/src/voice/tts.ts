import { live, useStore } from '../store'

/**
 * Text-to-speech with the browser's built-in voices (free, no download).
 *
 * Reliability matters more than anything here, because the wake listener
 * ignores what it hears while FRIDAY is speaking. The browser's own queue is
 * not trusted: Edge's online "Natural" voices sometimes never start or never
 * report that they ended. So sentences are spoken one at a time from our own
 * queue, each with two watchdogs:
 *   - no start within START_TIMEOUT_MS  -> speak it again with an offline voice
 *   - no end within an estimated length -> treat it as finished and move on
 * After two online failures the rest of the session uses offline voices.
 */
const synth: SpeechSynthesis | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined
const DEVANAGARI = /[ऀ-ॿ]/
const START_TIMEOUT_MS = 2500
const LOCAL_START_TIMEOUT_MS = 2000
const AFTER_CANCEL_MS = 120

let voices: SpeechSynthesisVoice[] = []
function loadVoices() {
  if (synth) voices = synth.getVoices()
}
if (synth) {
  loadVoices()
  synth.addEventListener?.('voiceschanged', loadVoices)
}

export const ttsSupported = !!synth
export type VoiceMode = 'natural' | 'fast'

export function listVoices(): SpeechSynthesisVoice[] {
  loadVoices()
  return voices.filter((v) => /^(en|hi)/i.test(v.lang))
}

function score(v: SpeechSynthesisVoice, hindi: boolean, offlineOnly: boolean): number {
  if (offlineOnly && !v.localService) return -1
  const name = v.name.toLowerCase()
  const lang = v.lang.toLowerCase().replace('_', '-')
  let s = 0
  if (hindi) {
    if (lang.startsWith('hi')) s += 100
  } else if (lang === 'en-in') s += 60
  else if (lang.startsWith('en-gb')) s += 45
  else if (lang.startsWith('en')) s += 30
  if (name.includes('natural') || name.includes('online')) s += 25
  if (name.includes('google')) s += 8
  // FRIDAY speaks with a calm female voice (Edge: Neerja / Swara; Windows: Heera / Kalpana).
  if (/neerja|swara|heera|kalpana|sonia|libby|emily|jenny|aria|ava|zira/.test(name)) s += 6
  return s
}

export function pickVoice(text: string, preferred: string, offlineOnly = false): SpeechSynthesisVoice | undefined {
  if (!voices.length) loadVoices()
  const hindi = DEVANAGARI.test(text)
  if (preferred) {
    const v = voices.find((x) => x.name === preferred)
    // A chosen English voice cannot read Devanagari, so Hindi falls back to a Hindi voice.
    if (v && (!offlineOnly || v.localService) && (!hindi || v.lang.toLowerCase().startsWith('hi'))) return v
  }
  let best: SpeechSynthesisVoice | undefined
  let bestScore = 0
  for (const v of voices) {
    const sc = score(v, hindi, offlineOnly)
    if (sc > bestScore) {
      best = v
      bestScore = sc
    }
  }
  return best
}

function clean(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[*_#`>|~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Sentence end: . ! ? । followed by whitespace, or a newline.
const SENTENCE = /^[\s\S]*?(?:[.!?।…]+(?=\s)|\n)/

interface Item {
  text: string
  voiceName: string
  rate: number
  offline: boolean
}

class Speaker {
  enabled = true
  voiceName = ''
  rate = 1.05
  mode: VoiceMode = 'natural'
  /** When the last sentence finished; the wake listener ignores her own echo. */
  lastEnded = 0
  private buf = ''
  private msgId = ''
  private queue: Item[] = []
  private current: SpeechSynthesisUtterance | null = null // also keeps a ref so Chrome fires its events
  private gen = 0
  private cancelledAt = 0
  private onlineFailures = 0
  private warned = false

  configure(o: { enabled?: boolean; voiceName?: string; rate?: number; mode?: VoiceMode }) {
    if (o.enabled !== undefined) this.enabled = o.enabled
    if (o.voiceName !== undefined) this.voiceName = o.voiceName
    if (o.rate !== undefined) this.rate = o.rate
    if (o.mode !== undefined) this.mode = o.mode
    if (!this.enabled) this.stop()
  }

  /** Streaming text for message `id`. */
  feed(id: string, text: string) {
    if (!this.enabled || !synth) return
    if (id !== this.msgId) {
      this.msgId = id
      this.buf = ''
    }
    this.buf += text
    this.drain(false)
  }

  /** Message finished: speak whatever is left. */
  end(id: string, fullText: string) {
    if (!this.enabled || !synth) return
    if (id !== this.msgId) {
      this.msgId = id
      this.buf = fullText
    }
    this.drain(true)
  }

  /** Speak a one-off phrase (settings preview), even if replies are muted. */
  preview(text: string, voiceName: string, rate: number, mode: VoiceMode) {
    if (!synth) return
    this.stop()
    this.enqueue(text, { voiceName, rate, offline: mode === 'fast' })
  }

  stop() {
    this.gen++
    this.buf = ''
    this.msgId = ''
    this.queue = []
    this.current = null
    this.cancelledAt = Date.now()
    this.lastEnded = Date.now()
    synth?.cancel()
    useStore.getState().setSpeaking(false)
  }

  private drain(final: boolean) {
    for (;;) {
      const fence = this.buf.indexOf('```')
      const head = fence === -1 ? this.buf : this.buf.slice(0, fence)
      let m: RegExpMatchArray | null
      let consumed = 0
      while ((m = head.slice(consumed).match(SENTENCE))) {
        this.enqueue(m[0])
        consumed += m[0].length
      }
      if (fence === -1) {
        this.buf = this.buf.slice(consumed)
        if (final) {
          this.enqueue(this.buf)
          this.buf = ''
        }
        return
      }
      // Text before the code block is spoken; the code itself is not.
      this.enqueue(head.slice(consumed))
      const close = this.buf.indexOf('```', fence + 3)
      if (close === -1) {
        this.buf = this.buf.slice(fence) // wait for the rest of the block
        if (final) {
          this.enqueue('Code screen par hai.')
          this.buf = ''
        }
        return
      }
      this.enqueue('Code screen par hai.')
      this.buf = this.buf.slice(close + 3)
    }
  }

  private enqueue(raw: string, opts?: Partial<Item>) {
    if (!synth) return
    const text = clean(raw)
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return
    this.queue.push({
      text,
      voiceName: opts?.voiceName ?? this.voiceName,
      rate: opts?.rate ?? this.rate,
      offline: opts?.offline ?? (this.mode === 'fast' || this.onlineFailures >= 2),
    })
    useStore.getState().setSpeaking(true)
    if (!this.current) this.next()
  }

  private next() {
    const s = synth
    const item = this.queue.shift()
    if (!s || !item) {
      this.current = null
      this.lastEnded = Date.now()
      useStore.getState().setSpeaking(false)
      return
    }
    const gen = this.gen
    const voice = pickVoice(item.text, item.voiceName, item.offline)
    const online = !!voice && !voice.localService
    const u = new SpeechSynthesisUtterance(item.text)
    if (voice) {
      u.voice = voice
      u.lang = voice.lang
    }
    u.rate = item.rate
    let started = false
    let finished = false
    let startTimer = 0
    let endTimer = 0
    let poll = 0

    const finish = () => {
      if (finished || gen !== this.gen) return
      finished = true
      window.clearTimeout(startTimer)
      window.clearTimeout(endTimer)
      window.clearInterval(poll)
      this.current = null
      this.lastEnded = Date.now()
      this.next()
    }
    // The online voice did not work: say the same sentence with an offline voice.
    const retryOffline = () => {
      if (finished || gen !== this.gen) return
      finished = true
      window.clearTimeout(startTimer)
      window.clearTimeout(endTimer)
      window.clearInterval(poll)
      this.onlineFailures++
      if (this.onlineFailures >= 2 && !this.warned) {
        this.warned = true
        useStore.getState().showToast('Online awaaz atak rahi thi, isliye ab offline awaaz use kar rahi hoon.', 'info')
      }
      this.current = null
      this.cancelledAt = Date.now()
      s.cancel()
      this.queue.unshift({ ...item, offline: true })
      this.next()
    }

    u.onstart = () => {
      if (finished || gen !== this.gen) return
      started = true
      window.clearTimeout(startTimer)
      live.bump(0.5)
      // Browsers sometimes never fire onend. Ask the synthesizer directly whether it
      // is still talking, and as a last resort move on after a generous estimate.
      const startedAt = Date.now()
      poll = window.setInterval(() => {
        if (Date.now() - startedAt > 600 && !s.speaking && !s.pending) finish()
      }, 300)
      const estimate = 2000 + (item.text.length * 90) / Math.max(0.5, item.rate)
      endTimer = window.setTimeout(finish, estimate)
    }
    u.onboundary = () => live.bump(0.35)
    u.onend = finish
    u.onerror = (e) => {
      const err = (e as SpeechSynthesisErrorEvent).error
      if (err === 'interrupted' || err === 'canceled') return finish()
      if (online && !started) retryOffline()
      else finish()
    }
    startTimer = window.setTimeout(
      () => {
        if (started) return
        if (online) retryOffline()
        else {
          s.cancel() // offline voice did not start either: skip this sentence
          finish()
        }
      },
      online ? START_TIMEOUT_MS : LOCAL_START_TIMEOUT_MS,
    )

    this.current = u
    useStore.getState().setSpeaking(true)
    // Chrome/Edge drop an utterance spoken right after cancel(), and can stay paused.
    const wait = Math.max(0, AFTER_CANCEL_MS - (Date.now() - this.cancelledAt))
    window.setTimeout(() => {
      if (gen !== this.gen || finished) return
      if (s.paused) s.resume()
      s.speak(u)
    }, wait)
  }
}

export const speaker = new Speaker()
