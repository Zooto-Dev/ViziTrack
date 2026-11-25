import { useEffect } from 'react'
import { useStore } from '../store'
import { api } from '../ws'

export function ConfirmDialog() {
  const c = useStore((s) => s.confirm)
  const name = useStore((s) => s.settings?.assistant_name || 'FRIDAY')
  useEffect(() => {
    if (!c) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') api.confirm(c.request_id, true)
      if (e.key === 'Escape') api.confirm(c.request_id, false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [c])
  if (!c) return null
  return (
    <div className="modal-backdrop">
      <div className="modal confirm">
        <div className="modal-title">CONFIRM ACTION</div>
        <p>
          {name} wants to run <b className="mono">{c.tool}</b>
        </p>
        <pre className="mono args">{JSON.stringify(c.args, null, 2)}</pre>
        <p className="dim">{c.reason}</p>
        <div className="modal-actions">
          <button className="btn" onClick={() => api.confirm(c.request_id, false)}>
            Cancel (Esc)
          </button>
          <button className="btn btn-send" onClick={() => api.confirm(c.request_id, true)}>
            Allow (Enter)
          </button>
        </div>
      </div>
    </div>
  )
}
