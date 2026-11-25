import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { ttsSupported } from '../voice/tts'
import { wakeSupported } from '../voice/wake'

/**
 * Short start-up sequence (about 1.6 s, click to skip). Every line reports a
 * real check: backend link, AI provider, speech output, speech input.
 */
export function Boot() {
  const [done, setDone] = useState(() => {
    try {
      return sessionStorage.getItem('friday-booted') === '1' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  })
  const connected = useStore((s) => s.connected)
  const provider = useStore((s) => s.settings?.provider)
  const name = useStore((s) => s.settings?.assistant_name || 'Friday')

  useEffect(() => {
    if (done) return
    const id = window.setTimeout(() => finish(), 1900)
    return () => window.clearTimeout(id)
  })

  function finish() {
    try {
      sessionStorage.setItem('friday-booted', '1')
    } catch {
      /* private mode */
    }
    setDone(true)
  }

  if (done) return null
  const lines: [string, string, boolean][] = [
    ['NEURAL LINK', connected ? 'ONLINE' : 'CONNECTING', connected],
    ['AI CORE', provider ? `${provider.name.toUpperCase()}` : 'PENDING', !!provider],
    ['VOICE SYNTHESIS', ttsSupported ? 'READY' : 'UNAVAILABLE', ttsSupported],
    ['SPEECH RECOGNITION', wakeSupported ? 'READY' : 'UNAVAILABLE', wakeSupported],
  ]
  return (
    <div className="boot" onClick={finish} role="presentation">
      <div className="boot-inner">
        <div className="boot-title">{name.toUpperCase().split('').join(' ')}</div>
        <div className="boot-sub mono">INITIALIZING PERSONAL AI SYSTEM</div>
        <div className="boot-bar">
          <i />
        </div>
        <ul className="boot-lines mono">
          {lines.map(([k, v, ok], i) => (
            <li key={k} style={{ animationDelay: `${0.15 + i * 0.22}s` }}>
              <span>{k}</span>
              <span className="dots" />
              <b className={ok ? 'ok' : 'warn'}>{v}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
