import { useEffect, useState } from 'react'
import { uiState, useStore } from '../store'

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

export function Hud() {
  const connected = useStore((s) => s.connected)
  const state = useStore(uiState)
  const provider = useStore((s) => s.settings?.provider)
  const version = useStore((s) => s.version)
  const open = useStore((s) => s.setSettingsOpen)

  return (
    <header className="hud">
      <div className="hud-left">
        <div className="wordmark">
          <span className="wordmark-main">J.A.R.V.I.S.</span>
          <span className="wordmark-sub">Personal AI Operating System {version && `· v${version}`}</span>
        </div>
      </div>
      <div className="hud-center">
        <div className={`state-pill state-${state}`}>
          <span className="dot" />
          {STATE_LABEL[state] ?? state.toUpperCase()}
        </div>
      </div>
      <div className="hud-right">
        <button className="chip" onClick={() => open(true)} title="Settings (Ctrl+,)">
          <span className={`dot ${connected ? 'ok' : 'bad'}`} />
          {connected ? 'LINK' : 'OFFLINE'}
          <span className="chip-sep">|</span>
          {provider ? `${provider.name}${provider.model ? ' · ' + provider.model : ''}` : '—'}
        </button>
        <Clock />
      </div>
    </header>
  )
}
