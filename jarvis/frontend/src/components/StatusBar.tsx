import { useStore } from '../store'

/** Bottom telemetry strip: everything here is a live value, nothing decorative. */
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

  const wake = !wakeOn ? 'OFF' : wakeStatus === 'listening' ? 'LISTENING' : wakeStatus.toUpperCase().replace('-', ' ')
  return (
    <footer className="statusbar mono">
      <span className={connected ? 'ok' : 'bad'}>● CORE {connected ? 'ONLINE' : 'OFFLINE'}</span>
      <span>
        AI <b>{provider ? `${provider.name.toUpperCase()} · ${provider.model}` : '—'}</b>
        {warm.state === 'loading' && <i> (loading)</i>}
      </span>
      <span>
        RESPONSE <b>{latency === null ? '—' : latency < 1000 ? `${latency} ms` : `${(latency / 1000).toFixed(1)} s`}</b>
      </span>
      <span>
        VOICE <b>{speakOn === false ? 'MUTED' : voiceMode === 'fast' ? 'FAST' : 'NATURAL'}</b>
      </span>
      <span className={wakeOn && wakeStatus === 'listening' ? 'ok' : ''}>
        WAKE <b>{wake}</b>
      </span>
      <span>
        MIC <b>{micActive ? 'LIVE' : 'IDLE'}</b>
      </span>
      <span className="grow" />
      <span className="dim">CTRL+SPACE TALK · CTRL+, SETTINGS</span>
    </footer>
  )
}
