import { useEffect } from 'react'
import { useStore } from '../store'

export function Toast() {
  const toast = useStore((s) => s.toast)
  const clear = useStore((s) => s.clearToast)
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(clear, 6000)
    return () => window.clearTimeout(id)
  }, [toast, clear])
  if (!toast) return null
  return (
    <div className={`toast ${toast.kind}`} role="status" onClick={clear}>
      {toast.text}
    </div>
  )
}
