import { memo, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Message } from '../types'
import { api } from '../ws'
import { EXAMPLES, toolWords, viaWords } from '../words'

/** Plain text with ```fenced``` code blocks shown as code. */
function RichText({ text }: { text: string }) {
  if (!text.includes('```')) return <>{text}</>
  const parts = text.split('```')
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="code">
            {part.replace(/^[\w+-]*\n/, '')}
          </pre>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

const Bubble = memo(function Bubble({ m }: { m: Message }) {
  if (m.role === 'tool') {
    return (
      <div className={`tool-chip ${m.ok ? 'ok' : 'fail'}`} title={`${m.name}: ${m.text}`}>
        <span className="tool-icon">{m.ok ? '✓' : '✗'}</span>
        <span className="tool-name">{toolWords(m.name ?? '', !!m.ok)}</span>
        {!m.ok && <span className="tool-result">{m.text.split('\n')[0].slice(0, 90)}</span>}
      </div>
    )
  }
  if (m.role === 'error') {
    return <div className="bubble error">{m.text}</div>
  }
  const who = m.role === 'user' ? 'AAP' : (useStore.getState().settings?.assistant_name || 'FRIDAY').toUpperCase()
  const time = m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <div className={`bubble ${m.role}`}>
      <div className="bubble-who mono">
        {who}
        {time && <span> · {time}</span>}
      </div>
      <div className="bubble-text">
        <RichText text={m.text} />
      </div>
      {m.role === 'assistant' && (m.via || m.interrupted) && (
        <div className="bubble-meta mono">
          {m.interrupted ? 'beech me roka · ' : ''}
          <span className={m.via === 'direct' ? 'instant' : ''}>{viaWords(m.via)}</span>
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
        Soch rahi hoon… <span className="mono dim">{secs}s</span>
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
        <RichText text={streaming.text} />
        <span className="caret" />
      </div>
    </div>
  )
}

export function Conversation() {
  const messages = useStore((s) => s.messages)
  const streamingText = useStore((s) => s.streaming?.text.length ?? 0)
  const thinking = useStore((s) => s.state === 'thinking')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll only the log itself; scrollIntoView would also scroll the page on phones.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, streamingText, thinking])

  return (
    <div className="panel conversation">
      <div className="panel-title">
        <span>BAATCHEET</span>
        <span className="tag">{messages.filter((m) => m.role === 'user').length} sawaal</span>
      </div>
      <div className="conversation-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty">
            <p>Namaste! Mujhse kuch bhi boliye ya likhiye. In me se kisi par click karke bhi try kar sakte hain:</p>
            <div className="examples">
              {EXAMPLES.map((e) => (
                <button key={e} className="example" onClick={() => api.chat(e)}>
                  “{e}”
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        <Thinking />
        <Streaming />
      </div>
    </div>
  )
}
