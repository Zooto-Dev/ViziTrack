import { useCallback, useEffect, useRef, useState } from 'react'
import { uiState, useStore } from '../store'
import { api } from '../ws'
import { speaker } from '../voice/tts'
import { startListening, stopListening, sttSupported } from '../voice/stt'
import { pauseWake, resumeWake } from '../voice/wake'

export function Composer() {
  const [text, setText] = useState('')
  const state = useStore(uiState)
  const listening = useStore((s) => s.listening)
  const connected = useStore((s) => s.connected)
  const ref = useRef<HTMLTextAreaElement>(null)
  const busy = state === 'thinking' || state === 'executing' || state === 'speaking' || state === 'waiting'

  const submit = useCallback(() => {
    const t = text.trim()
    if (!t) return
    api.chat(t)
    setText('')
    ref.current?.focus()
  }, [text])

  const toggleMic = useCallback(() => {
    const st = useStore.getState()
    if (st.listening) {
      stopListening()
      return
    }
    speaker.stop() // barge-in: talking over FRIDAY stops it
    pauseWake()
    st.setListening(true)
    setText('')
    const lang = st.settings?.voice?.stt_lang || 'en-IN'
    startListening(lang, {
      onInterim: (t) => setText(t),
      onFinal: (t) => {
        setText('')
        api.chat(t)
      },
      onEnd: () => {
        useStore.getState().setListening(false)
        resumeWake()
      },
      onError: (m) => useStore.getState().showToast(m, 'error'),
    })
  }, [])

  // Ctrl+Space = push to talk, from anywhere in the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault()
        toggleMic()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleMic])

  return (
    <div className={`composer ${listening ? 'is-listening' : ''}`}>
      {sttSupported && (
        <button
          className={`btn btn-mic ${listening ? 'on' : ''}`}
          onClick={toggleMic}
          disabled={!connected}
          title="Bol kar command dein (Ctrl+Space)"
          aria-label={listening ? 'Stop listening' : 'Start listening'}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <path
              fill="currentColor"
              d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
            />
          </svg>
        </button>
      )}
      <textarea
        ref={ref}
        className="composer-input"
        rows={1}
        placeholder={
          !connected
            ? 'Connecting to FRIDAY…'
            : listening
              ? 'Sun rahi hoon… boliye'
              : 'Boliye ya likhiye… (Enter)'
        }
        value={text}
        disabled={!connected}
        readOnly={listening}
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
        <button className="btn btn-send" onClick={submit} disabled={!connected || !text.trim() || listening}>
          SEND ↵
        </button>
      )}
    </div>
  )
}
