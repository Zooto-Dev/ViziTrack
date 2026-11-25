import { useStore } from '../store'
import { api } from '../ws'

/** Pending tasks from the backend; ticking one off runs the real complete_task tool. */
export function TaskPanel() {
  const tasks = useStore((s) => s.tasks)
  const connected = useStore((s) => s.connected)
  return (
    <div className="panel tasks">
      <div className="panel-title">
        <span>MISSION QUEUE</span>
        <span className="tag">{tasks.length} PENDING</span>
      </div>
      {tasks.length === 0 ? (
        <div className="dim small">Koi pending task nahi. Boliye: “add task GST file karna”.</div>
      ) : (
        <ul className="task-list">
          {tasks.slice(0, 6).map((t) => (
            <li key={t.id}>
              <button
                className="task-check"
                disabled={!connected}
                title="Done mark karo"
                onClick={() => api.chat(`task ${t.id} done`)}
                aria-label={`Complete ${t.title}`}
              />
              <span className="task-title">{t.title}</span>
              {t.due && <span className="task-due mono">{t.due}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
