/**
 * Live microphone spectrum for the reactor's waveform ring, so the ring moves
 * with the user's real voice instead of a canned animation.
 *
 * Runs only while the wake word or push-to-talk is active, uses one small
 * AnalyserNode (256-point FFT) and is read by the canvas once per frame.
 * If the microphone is not available, the reactor falls back to its own
 * motion and nothing breaks.
 */
import { useStore } from '../store'

let audio: AudioContext | null = null
let analyser: AnalyserNode | null = null
let stream: MediaStream | null = null
let bins: Uint8Array<ArrayBuffer> | null = null
let starting = false

function resumeOnGesture() {
  const resume = () => {
    audio?.resume().catch(() => undefined)
    window.removeEventListener('pointerdown', resume)
    window.removeEventListener('keydown', resume)
  }
  window.addEventListener('pointerdown', resume)
  window.addEventListener('keydown', resume)
}

export async function startMicLevel(): Promise<void> {
  if (analyser || starting || !navigator.mediaDevices?.getUserMedia) return
  starting = true
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    audio = new AudioContext()
    if (audio.state === 'suspended') resumeOnGesture()
    const src = audio.createMediaStreamSource(stream)
    analyser = audio.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.75
    src.connect(analyser)
    bins = new Uint8Array(analyser.frequencyBinCount)
    useStore.getState().setMicActive(true)
  } catch {
    stopMicLevel()
  } finally {
    starting = false
  }
}

export function stopMicLevel(): void {
  stream?.getTracks().forEach((t) => t.stop())
  audio?.close().catch(() => undefined)
  stream = null
  audio = null
  analyser = null
  bins = null
  useStore.getState().setMicActive(false)
}

/** Current spectrum (0..255 per bin, voice range first), or null when off. */
export function micSpectrum(): Uint8Array | null {
  if (!analyser || !bins) return null
  analyser.getByteFrequencyData(bins)
  return bins
}

/** Overall loudness 0..1 from the voice band. */
export function micLevel(spec: Uint8Array): number {
  let sum = 0
  const n = Math.min(48, spec.length)
  for (let i = 2; i < n; i++) sum += spec[i]
  return Math.min(1, sum / ((n - 2) * 255) * 2.2)
}
