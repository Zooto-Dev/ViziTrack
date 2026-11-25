/**
 * Speech-to-text with the browser's built-in recognizer (Chrome / Edge).
 * Free, no download, low latency. Needs an internet connection: the audio is
 * recognized by Google (Chrome) or Microsoft (Edge).
 */

// The Web Speech API is not in TypeScript's DOM lib yet.
interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => Recognition

const Ctor: RecognitionCtor | undefined =
  typeof window !== 'undefined'
    ? ((window as unknown as Record<string, RecognitionCtor | undefined>).SpeechRecognition ??
      (window as unknown as Record<string, RecognitionCtor | undefined>).webkitSpeechRecognition)
    : undefined

export const sttSupported = !!Ctor

const ERRORS: Record<string, string> = {
  'not-allowed': 'Mic ki permission nahi mili. Window ke upar mic icon par click karke Allow karein.',
  'service-not-allowed': 'Mic ki permission nahi mili. Window ke upar mic icon par click karke Allow karein.',
  'no-speech': 'Kuch sunai nahi diya. Mic button dabakar dobara bolein.',
  'audio-capture': 'Mic nahi mila. Check karein ki mic laga hai aur Windows me on hai.',
  network: 'Awaaz pehchanne ke liye internet chahiye. Connection check karein.',
}

let current: Recognition | null = null

export interface ListenHandlers {
  onInterim(text: string): void
  onFinal(text: string): void
  onEnd(): void
  onError(message: string): void
}

export function startListening(lang: string, h: ListenHandlers): void {
  if (!Ctor) {
    h.onError('Is browser me voice input nahi hai. FRIDAY ko Chrome ya Edge me kholein.')
    h.onEnd()
    return
  }
  stopListening()
  const rec = new Ctor()
  rec.lang = lang
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1
  let finalText = ''
  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else interim += r[0].transcript
    }
    if (interim) h.onInterim(finalText + interim)
  }
  rec.onerror = (e) => {
    if (e.error !== 'aborted') h.onError(ERRORS[e.error] ?? `Voice error: ${e.error}`)
  }
  rec.onend = () => {
    if (current === rec) current = null
    const t = finalText.trim()
    if (t) h.onFinal(t)
    h.onEnd()
  }
  current = rec
  rec.start()
}

export function stopListening(): void {
  try {
    current?.stop()
  } catch {
    /* already stopped */
  }
}

export function isListening(): boolean {
  return current !== null
}
