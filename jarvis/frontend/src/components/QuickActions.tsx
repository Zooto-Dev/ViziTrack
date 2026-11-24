import { useStore } from '../store'
import { api } from '../ws'

/** Every button here performs a real action through the backend. */
const ACTIONS: { label: string; icon: string; text: string }[] = [
  { label: 'System status', icon: '◉', text: 'system status' },
  { label: 'Pending tasks', icon: '☰', text: 'mere pending tasks' },
  { label: 'Time & date', icon: '◷', text: 'what time is it' },
  { label: 'Open YouTube', icon: '▶', text: 'open youtube' },
  { label: 'Open Chrome', icon: '◍', text: 'open chrome' },
  { label: 'What I told you', icon: '◈', text: 'what do you remember about me?' },
]

export function QuickActions() {
  const connected = useStore((s) => s.connected)
  const openSettings = useStore((s) => s.setSettingsOpen)
  return (
    <div className="panel quick">
      <div className="panel-title">
        <span>QUICK ACTIONS</span>
      </div>
      <div className="quick-grid">
        {ACTIONS.map((a) => (
          <button key={a.label} className="quick-btn" disabled={!connected} onClick={() => api.chat(a.text)}>
            <span className="quick-icon">{a.icon}</span>
            <span>{a.label}</span>
          </button>
        ))}
        <button className="quick-btn" onClick={() => openSettings(true)}>
          <span className="quick-icon">⚙</span>
          <span>Settings</span>
        </button>
        <button
          className="quick-btn danger"
          disabled={!connected}
          onClick={() => {
            if (confirm('Clear the conversation history? Memories and tasks are kept.')) api.clearHistory()
          }}
        >
          <span className="quick-icon">⌫</span>
          <span>Clear chat</span>
        </button>
      </div>
    </div>
  )
}
