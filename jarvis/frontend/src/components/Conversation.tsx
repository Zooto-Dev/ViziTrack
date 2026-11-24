import { memo, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Message } from '../types'

const Bubble = memo(function Bubble({ m }: { m: Message }) {
  if (m.role === 'tool') {
    return (
      <div className={`tool-chip ${m.ok ? 'ok' : 'fail'}`} title={m.text}>
        <span className="tool-icon">{m.ok ? '✓' : '✕'}</span>
        <span className="tool-name mono">{m.name}</span>
        <span className="tool-result">{m.text.split('\n')[0].slice(0, 90)}</span>
        {typeof m.ms === 'number' && <span className="tool-ms mono">{m.ms}ms</span>}
      </div>
    )
  }
  if (m.role === 'error') {
    return <div className="bubble error">{m.text}</div>
  }
  return (
    <div className={`bubble ${m.role}`}>
      <div className="bubble-text">{m.text}</div>
      {m.role === 'assistant' && (m.via || m.interrupted) && (
        <div className="bubble-meta mono">
          {m.interrupted ? 'interrupted · ' : ''}
          {m.via}
        </div>
      )}
    </div>
  )
})

/** Shown while the AI is working but has not produced a word yet. */
function Thinking() {
  const since = useStore((s) => (s.state === 'thinking' && !s.streaming ? s.thinkingSince : 0))
  const local = useStore((s) => s.settings?.provider.name === 'ollama')
  const [, tick] = useState(0)
  useEffect(() => {
    if (!since) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [since])
  if (!since) return null
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000))
  return (
    <div className="bubble assistant thinking">
      <div className="bubble-text">
        <span className="dots">
          <i />
          <i />
          <i />
        </span>{' '}
        Soch raha hoon… <span className="mono dim">{secs}s</span>
      </div>
      {local && secs >= 8 && (
        <div className="bubble-meta">
          Local AI is PC ke CPU par chal raha hai, isliye time lagta hai. Pehla jawab sabse slow hota hai. Tez jawab ke liye Settings me free Groq chunein.
        </div>
      )}
    </div>
  )
}

function Streaming() {
  const streaming = useStore((s) => s.streaming)
  if (!streaming) return null
  return (
    <div className="bubble assistant streaming">
      <div className="bubble-text">
        {streaming.text}
        <span className="caret" />
      </div>
    </div>
  )
}

export function Conversation() {
  const messages = useStore((s) => s.messages)
  const streamingText = useStore((s) => s.streaming?.text.length ?? 0)
  const thinking = useStore((s) => s.state === 'thinking')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, streamingText, thinking])

  return (
    <div className="panel conversation">
      <div className="panel-title">
        <span>CONVERSATION</span>
        <span className="mono dim">{messages.filter((m) => m.role !== 'tool').length}</span>
      </div>
      <div className="conversation-scroll">
        {messages.length === 0 && (
          <div className="empty">
            <p>Mic dabaiye aur boliye: “chrome kholo”, “youtube kholo”, “time kya hua”, “yaad rakhna meri meeting 5 baje hai”, “mere pending tasks”.</p>
            <p className="dim">General questions go to your configured AI provider.</p>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        <Thinking />
        <Streaming />
        <div ref={endRef} />
      </div>
    </div>
  )
}
