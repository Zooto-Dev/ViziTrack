import { useState } from 'react'
import { useStore } from '../store'
import { api } from '../ws'

/** Pending tasks. Adding and ticking off run the real task tools. */
export function TaskPanel() {
  const tasks = useStore((s) => s.tasks)
  const connected = useStore((s) => s.connected)
  const [text, setText] = useState('')

  const add = () => {
    const t = text.trim()
    if (!t) return
    api.chat(`task add karo: ${t}`)
    setText('')
  }

  return (
    <div className="panel tasks">
      <div className="panel-title">
        <span>MERE KAAM</span>
        <span className="tag">{tasks.length ? `${tasks.length} baaki` : 'sab poore'}</span>
      </div>
      {tasks.length > 0 && (
        <ul className="task-list">
          {tasks.slice(0, 6).map((t) => (
            <li key={t.id}>
              <button
                className="task-check"
                disabled={!connected}
                title="Poora ho gaya? Click karein"
                onClick={() => api.chat(`task ${t.id} done`)}
                aria-label={`${t.title} poora mark karein`}
              />
              <span className="task-title">{t.title}</span>
              {t.due && <span className="task-due mono">{t.due}</span>}
            </li>
          ))}
        </ul>
      )}
      <form
        className="task-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Naya kaam likhiye…"
          disabled={!connected}
          aria-label="Naya kaam"
        />
        <button type="submit" disabled={!connected || !text.trim()}>
          + Jodo
        </button>
      </form>
      {tasks.length > 0 && <div className="hint-line">◇ par click = kaam poora</div>}
    </div>
  )
}
