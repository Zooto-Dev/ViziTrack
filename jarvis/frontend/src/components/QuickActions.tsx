import type { ReactNode } from 'react'
import { useStore } from '../store'
import { api } from '../ws'

const I = (d: string) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Every button runs a real command; the small line says what it does. */
const ACTIONS: { label: string; what: string; icon: ReactNode; text: string }[] = [
  { label: 'PC ki halat', what: 'CPU, RAM batao', icon: I('M3 12h4l3-8 4 16 3-8h4'), text: 'system status' },
  { label: 'Mere kaam', what: 'pending list', icon: I('M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2'), text: 'mere pending tasks' },
  { label: 'Latest Excel', what: 'nayi file kholo', icon: I('M4 4h16v16H4zM4 10h16M4 15h16M10 4v16'), text: 'meri latest excel file kholo' },
  { label: 'Time', what: 'time aur date', icon: I('M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'), text: 'time kya hua' },
  { label: 'YouTube', what: 'browser me kholo', icon: I('M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM10 9l5 3-5 3z'), text: 'youtube kholo' },
  { label: 'Meri yaadein', what: 'jo yaad rakha', icon: I('M9 3a4 4 0 0 0-4 4v1a3 3 0 0 0 0 6v1a4 4 0 0 0 7 2.6A4 4 0 0 0 19 15v-1a3 3 0 0 0 0-6V7a4 4 0 0 0-7-2.6A4 4 0 0 0 9 3zM12 4v16'), text: 'what do you remember about me?' },
]

export function QuickActions() {
  const connected = useStore((s) => s.connected)
  const openSettings = useStore((s) => s.setSettingsOpen)
  return (
    <div className="panel quick">
      <div className="panel-title">
        <span>SHORTCUTS</span>
        <span className="tag">ek click</span>
      </div>
      <div className="quick-grid">
        {ACTIONS.map((a) => (
          <button key={a.label} className="quick-btn" disabled={!connected} onClick={() => api.chat(a.text)} title={`Command: “${a.text}”`}>
            <span className="quick-icon">{a.icon}</span>
            <span className="quick-text">
              <b>{a.label}</b>
              <i>{a.what}</i>
            </span>
          </button>
        ))}
        <button className="quick-btn" onClick={() => openSettings(true)}>
          <span className="quick-icon">{I('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z')}</span>
          <span className="quick-text">
            <b>Settings</b>
            <i>AI, awaaz, theme</i>
          </span>
        </button>
        <button
          className="quick-btn danger"
          disabled={!connected}
          onClick={() => {
            if (confirm('Baatcheet saaf karein? Aapke kaam aur yaadein bache rahenge.')) api.clearHistory()
          }}
        >
          <span className="quick-icon">{I('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3')}</span>
          <span className="quick-text">
            <b>Chat saaf</b>
            <i>nayi shuruaat</i>
          </span>
        </button>
      </div>
    </div>
  )
}
