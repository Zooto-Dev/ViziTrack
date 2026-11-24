import { useCallback, useRef, useState } from 'react'
import { useStore } from '../store'
import { api } from '../ws'

export function Composer() {
  const [text, setText] = useState('')
  const busy = useStore((s) => s.state !== 'idle' && s.state !== 'listening')
  const connected = useStore((s) => s.connected)
  const ref = useRef<HTMLTextAreaElement>(null)

  const submit = useCallback(() => {
    const t = text.trim()
    if (!t) return
    api.chat(t)
    setText('')
    ref.current?.focus()
  }, [text])

  return (
    <div className="composer">
      <textarea
        ref={ref}
        className="composer-input"
        rows={1}
        placeholder={connected ? 'Type a command or question… (Enter to send)' : 'Connecting to Jarvis backend…'}
        value={text}
        disabled={!connected}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        autoFocus
      />
      {busy ? (
        <button className="btn btn-stop" onClick={() => api.stop()} title="Stop (interrupt)">
          ■ STOP
        </button>
      ) : (
        <button className="btn btn-send" onClick={submit} disabled={!connected || !text.trim()}>
          SEND ↵
        </button>
      )}
    </div>
  )
}
