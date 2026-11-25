import { useStore } from '../store'
import { providerWords, secondsWords } from '../words'

/** Bottom strip in plain words. Every value is live. */
export function StatusBar() {
  const provider = useStore((s) => s.settings?.provider)
  const latency = useStore((s) => s.latencyMs)
  const wakeOn = useStore((s) => s.wakeOn)
  const wakeStatus = useStore((s) => s.wakeStatus)
  const micActive = useStore((s) => s.micActive)
  const voiceMode = useStore((s) => s.settings?.voice?.tts_mode)
  const speakOn = useStore((s) => s.settings?.voice?.speak_replies)
  const connected = useStore((s) => s.connected)
  const warm = useStore((s) => s.warm)
  const name = useStore((s) => s.settings?.assistant_name || 'Friday')

  const wake = !wakeOn
    ? 'band'
    : wakeStatus === 'listening'
      ? `“${name}” sun rahi hai`
      : wakeStatus === 'no-internet'
        ? 'internet nahi'
        : wakeStatus === 'no-mic'
          ? 'mic nahi mila'
          : 'jud rahi hai…'
  return (
    <footer className="statusbar">
      <span className={connected ? 'ok' : 'bad'}>● {connected ? 'Connected' : 'Connection toota'}</span>
      <span>
        AI: <b>{providerWords(provider?.name)}</b>
        {warm.state === 'loading' && <i> (load ho raha)</i>}
      </span>
      <span title="Aapke bolne se pehle shabd tak ka samay">
        Pichhla jawab: <b>{secondsWords(latency)}</b>
      </span>
      <span>
        Awaaz: <b>{speakOn === false ? 'band' : voiceMode === 'fast' ? 'tez (offline)' : 'natural'}</b>
      </span>
      <span className={wakeOn && wakeStatus === 'listening' ? 'ok' : ''}>
        Wake word: <b>{wake}</b>
      </span>
      <span>
        Mic: <b>{micActive ? 'on' : 'off'}</b>
      </span>
      <span className="grow" />
      <span className="dim">Ctrl+Space = bolo · ? = guide</span>
    </footer>
  )
}
