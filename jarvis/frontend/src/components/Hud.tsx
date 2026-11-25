import { useEffect, useState } from 'react'
import { uiState, useStore } from '../store'
import { api } from '../ws'
import { wakeSupported } from '../voice/wake'

const STATE_LABEL: Record<string, string> = {
  idle: 'STANDBY',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  speaking: 'RESPONDING',
  executing: 'EXECUTING',
  waiting: 'AWAITING CONFIRMATION',
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="hud-clock">
      <span className="mono">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      <span className="hud-date">{now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' })}</span>
    </div>
  )
}

function WakeToggle() {
  const on = useStore((s) => s.wakeOn)
  const status = useStore((s) => s.wakeStatus)
  const name = useStore((s) => s.settings?.assistant_name || 'Friday')
  const connected = useStore((s) => s.connected)
  if (!wakeSupported) return null
  return (
    <button
      className={`chip wake ${on ? 'on' : ''}`}
      disabled={!connected}
      onClick={() => api.setSettings({ voice: { wake_enabled: !on } })}
      title={on ? `Sun rahi hoon. "${name}" ya "Wake up" boliye. Band karne ke liye click karein.` : 'Click karke wake word on karein'}
    >
      <span className={`dot ${on ? (status === 'listening' ? 'ok' : 'warn') : ''}`} />
      {!on
        ? 'WAKE OFF'
        : status === 'no-internet'
          ? 'WAKE · INTERNET NAHI'
          : status === 'no-mic'
            ? 'WAKE · MIC NAHI MILA'
            : (
              <>
                WAKE ON<span className="chip-long"> · SAY "{name.toUpperCase()}"</span>
              </>
            )}
    </button>
  )
}

function spaced(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '').split('').join('.') + '.'
}

export function Hud() {
  const connected = useStore((s) => s.connected)
  const state = useStore(uiState)
  const provider = useStore((s) => s.settings?.provider)
  const version = useStore((s) => s.version)
  const open = useStore((s) => s.setSettingsOpen)
  const name = useStore((s) => s.settings?.assistant_name || 'Friday')
  useEffect(() => {
    document.title = spaced(name)
  }, [name])

  return (
    <header className="hud">
      <div className="hud-left">
        <svg className="logo" viewBox="0 0 40 40" aria-hidden>
          <polygon points="20,2 36,11 36,29 20,38 4,29 4,11" className="logo-hex" />
          <polygon points="20,10 28,15 28,25 20,30 12,25 12,15" className="logo-hex2" />
          <circle cx="20" cy="20" r="3.5" className="logo-core" />
        </svg>
        <div className="wordmark">
          <span className="wordmark-main">{spaced(name)}</span>
          <span className="wordmark-sub">Personal AI Operating System {version && `· v${version}`}</span>
        </div>
      </div>
      <div className="hud-center">
        <div className={`state-pill state-${state}`}>
          <span className="br">[</span>
          <span className="dot" />
          {STATE_LABEL[state] ?? state.toUpperCase()}
          <span className="br">]</span>
        </div>
      </div>
      <div className="hud-right">
        <WakeToggle />
        <button className="chip link" onClick={() => open(true)} title="Settings (Ctrl+,)">
          <span className={`dot ${connected ? 'ok' : 'bad'}`} />
          {connected ? 'LINK' : 'OFFLINE'}
          <span className="chip-sep">|</span>
          {provider ? provider.name : '—'}
          {provider?.model && <span className="chip-long"> · {provider.model}</span>}
        </button>
        <Clock />
      </div>
    </header>
  )
}
