import { live, useStore } from './store'
import type { Message, Settings } from './types'
import { speaker } from './voice/tts'

type Outgoing =
  | { type: 'chat'; text: string }
  | { type: 'stop' }
  | { type: 'confirm'; request_id: string; approved: boolean }
  | { type: 'settings.set'; patch: Record<string, unknown> }
  | { type: 'history.clear' }
  | { type: 'ping' }

let socket: WebSocket | null = null
let retry = 0
let retryTimer: number | undefined
const queue: Outgoing[] = []

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

export function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  const s = useStore.getState()
  socket = new WebSocket(wsUrl())

  socket.onopen = () => {
    retry = 0
    s.setConnected(true)
    while (queue.length) socket!.send(JSON.stringify(queue.shift()))
  }
  socket.onclose = () => {
    useStore.getState().setConnected(false)
    useStore.getState().setState('idle')
    const delay = Math.min(8000, 500 * 2 ** retry++)
    retryTimer = window.setTimeout(connect, delay)
  }
  socket.onerror = () => socket?.close()
  socket.onmessage = (ev) => handle(JSON.parse(ev.data))
}

export function disconnect(): void {
  window.clearTimeout(retryTimer)
  socket?.close()
  socket = null
}

export function send(msg: Outgoing): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  else queue.push(msg)
}

// ---- convenience API used by components --------------------------------
function applyVoice(s: Settings | null | undefined) {
  if (!s?.voice) return
  speaker.configure({ enabled: s.voice.speak_replies, voiceName: s.voice.tts_voice, rate: s.voice.tts_rate })
}

export const api = {
  chat(text: string) {
    const t = text.trim()
    if (!t) return
    speaker.stop() // a new command always interrupts Jarvis
    const st = useStore.getState()
    if (st.streaming) st.endStream(st.streaming.id, st.streaming.text, st.streaming.via, true)
    st.addMessage({ id: `u${Date.now()}`, role: 'user', text: t, ts: Date.now() })
    send({ type: 'chat', text: t })
  },
  stop() {
    speaker.stop()
    send({ type: 'stop' })
  },
  confirm(request_id: string, approved: boolean) {
    useStore.getState().setConfirm(null)
    send({ type: 'confirm', request_id, approved })
  },
  setSettings(patch: Record<string, unknown>) {
    send({ type: 'settings.set', patch })
  },
  clearHistory() {
    send({ type: 'history.clear' })
  },
  async testProvider() {
    const st = useStore.getState()
    st.setProviderStatus(null)
    try {
      const r = await fetch('/api/providers/test')
      const j = await r.json()
      st.setProviderStatus(j)
      return j
    } catch (e) {
      const j = { ok: false, detail: `Backend unreachable: ${String(e)}`, provider: '', model: '' }
      st.setProviderStatus(j)
      return j
    }
  },
}

// ---- incoming -----------------------------------------------------------
function handle(msg: Record<string, any>): void {
  const st = useStore.getState()
  switch (msg.type) {
    case 'hello':
      st.setHello({ settings: msg.settings, tools: msg.tools, history: msg.history as Message[], version: msg.version })
      if (msg.monitor) st.setMonitor(msg.monitor)
      if (msg.warm) st.setWarm(msg.warm)
      applyVoice(msg.settings)
      break
    case 'provider.warm':
      st.setWarm(msg as never)
      break
    case 'stopped':
      speaker.stop()
      st.setState('idle')
      break
    case 'monitor':
      st.setMonitor(msg as never)
      break
    case 'state':
      st.setState(msg.value)
      break
    case 'assistant.start':
      st.startStream(msg.id, msg.via)
      st.setState('speaking')
      break
    case 'assistant.delta':
      st.appendStream(msg.id, msg.text)
      speaker.feed(msg.id, msg.text)
      live.bump(0.25)
      break
    case 'assistant.end':
      st.endStream(msg.id, msg.text, msg.via, msg.interrupted)
      if (!msg.interrupted) speaker.end(msg.id, msg.text)
      break
    case 'tool.start':
      st.setState('executing')
      break
    case 'tool.end':
      st.addMessage({
        id: `t${msg.id}`,
        role: 'tool',
        name: msg.name,
        ok: msg.ok,
        text: msg.result,
        ms: msg.ms,
        ts: Date.now(),
      })
      break
    case 'confirm.request':
      st.setConfirm({ request_id: msg.request_id, tool: msg.tool, args: msg.args, reason: msg.reason })
      break
    case 'settings':
      st.setSettings(msg.settings)
      applyVoice(msg.settings)
      break
    case 'history':
      st.setMessages(msg.messages ?? [])
      break
    case 'error':
      st.showToast(msg.message, 'error')
      st.addMessage({ id: `e${Date.now()}`, role: 'error', text: msg.message, ts: Date.now() })
      break
    case 'pong':
      break
    default:
      console.debug('unhandled ws message', msg)
  }
}
