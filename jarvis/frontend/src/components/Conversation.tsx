import { memo, useEffect, useRef } from 'react'
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
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, streamingText])

  return (
    <div className="panel conversation">
      <div className="panel-title">
        <span>CONVERSATION</span>
        <span className="mono dim">{messages.filter((m) => m.role !== 'tool').length}</span>
      </div>
      <div className="conversation-scroll">
        {messages.length === 0 && (
          <div className="empty">
            <p>Try: “open chrome”, “youtube kholo”, “time kya hua”, “remember my car number is DL8C1234”, “mere pending tasks”.</p>
            <p className="dim">General questions go to your configured AI provider.</p>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        <Streaming />
        <div ref={endRef} />
      </div>
    </div>
  )
}
