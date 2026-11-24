import { live, useStore } from '../store'

/**
 * Text-to-speech with the browser's built-in voices (free, no download).
 * Edge ships natural "Online (Natural)" voices; Chrome on Windows has the
 * Microsoft voices plus Google voices. Replies are spoken sentence by sentence
 * while they stream, so FRIDAY starts talking before the answer is finished.
 */
const synth: SpeechSynthesis | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined
const DEVANAGARI = /[ऀ-ॿ]/

let voices: SpeechSynthesisVoice[] = []
function loadVoices() {
  if (synth) voices = synth.getVoices()
}
if (synth) {
  loadVoices()
  synth.addEventListener?.('voiceschanged', loadVoices)
}

export const ttsSupported = !!synth

export function listVoices(): SpeechSynthesisVoice[] {
  loadVoices()
  return voices.filter((v) => /^(en|hi)/i.test(v.lang))
}

function score(v: SpeechSynthesisVoice, hindi: boolean): number {
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

export function pickVoice(text: string, preferred: string): SpeechSynthesisVoice | undefined {
  if (!voices.length) loadVoices()
  const hindi = DEVANAGARI.test(text)
  if (preferred) {
    const v = voices.find((x) => x.name === preferred)
    // A chosen English voice cannot read Devanagari, so Hindi falls back to a Hindi voice.
    if (v && (!hindi || v.lang.toLowerCase().startsWith('hi'))) return v
  }
  let best: SpeechSynthesisVoice | undefined
  let bestScore = 0
  for (const v of voices) {
    const sc = score(v, hindi)
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

class Speaker {
  enabled = true
  voiceName = ''
  rate = 1.05
  /** When the last sentence finished; the wake listener ignores her own echo. */
  lastEnded = 0
  private buf = ''
  private msgId = ''
  private pending = new Set<SpeechSynthesisUtterance>() // keep refs: Chrome drops events of GC'd utterances

  configure(o: { enabled?: boolean; voiceName?: string; rate?: number }) {
    if (o.enabled !== undefined) this.enabled = o.enabled
    if (o.voiceName !== undefined) this.voiceName = o.voiceName
    if (o.rate !== undefined) this.rate = o.rate
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

  private drain(final: boolean) {
    for (;;) {
      const fence = this.buf.indexOf('```')
      const head = fence === -1 ? this.buf : this.buf.slice(0, fence)
      let m: RegExpMatchArray | null
      let consumed = 0
      while ((m = head.slice(consumed).match(SENTENCE))) {
        this.say(m[0])
        consumed += m[0].length
      }
      if (fence === -1) {
        this.buf = this.buf.slice(consumed)
        if (final) {
          this.say(this.buf)
          this.buf = ''
        }
        return
      }
      // Text before the code block is spoken; the code itself is not.
      this.say(head.slice(consumed))
      const close = this.buf.indexOf('```', fence + 3)
      if (close === -1) {
        this.buf = this.buf.slice(fence) // wait for the rest of the block
        if (final) {
          this.say('Code screen par hai.')
          this.buf = ''
        }
        return
      }
      this.say('Code screen par hai.')
      this.buf = this.buf.slice(close + 3)
    }
  }

  /** Speak a one-off phrase (settings preview). */
  preview(text: string, voiceName: string, rate: number) {
    if (!synth) return
    this.stop()
    const saved = { v: this.voiceName, r: this.rate }
    this.voiceName = voiceName
    this.rate = rate
    this.say(text)
    this.voiceName = saved.v
    this.rate = saved.r
  }

  private say(raw: string) {
    if (!synth) return
    const text = clean(raw)
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return
    const u = new SpeechSynthesisUtterance(text)
    const v = pickVoice(text, this.voiceName)
    if (v) {
      u.voice = v
      u.lang = v.lang
    }
    u.rate = this.rate
    u.onstart = () => {
      useStore.getState().setSpeaking(true)
      live.bump(0.5)
    }
    u.onboundary = () => live.bump(0.35)
    const done = () => {
      this.pending.delete(u)
      this.lastEnded = Date.now()
      if (this.pending.size === 0) useStore.getState().setSpeaking(false)
    }
    u.onend = done
    u.onerror = (e) => {
      done()
      // Online "Natural" voices fail without internet: retry once with a local voice.
      const err = (e as SpeechSynthesisErrorEvent).error
      if (err !== 'interrupted' && err !== 'canceled' && v && !v.localService) {
        const local = voices.find((x) => x.localService && x.lang.slice(0, 2) === v.lang.slice(0, 2))
        if (local) {
          const r = new SpeechSynthesisUtterance(text)
          r.voice = local
          r.lang = local.lang
          r.rate = this.rate
          r.onend = r.onerror = () => {
            this.pending.delete(r)
            if (this.pending.size === 0) useStore.getState().setSpeaking(false)
          }
          this.pending.add(r)
          synth.speak(r)
        }
      }
    }
    this.pending.add(u)
    useStore.getState().setSpeaking(true)
    // Chrome/Edge sometimes stay "paused" after cancel(); resume before speaking.
    if (synth.paused) synth.resume()
    synth.speak(u)
  }

  stop() {
    this.lastEnded = Date.now()
    this.buf = ''
    this.msgId = ''
    this.pending.clear()
    synth?.cancel()
    useStore.getState().setSpeaking(false)
  }
}

export const speaker = new Speaker()
