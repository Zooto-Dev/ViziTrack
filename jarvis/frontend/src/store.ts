import { create } from 'zustand'
import type { ConfirmRequest, JarvisState, Message, Monitor, ProviderStatus, Settings, ToolInfo, WarmState } from './types'

/**
 * Mutable, non-reactive signal for the reactor animation. Audio code (phase 3)
 * and the streaming handler write here; the canvas reads it every frame.
 * Keeping it outside React means zero re-renders per audio frame.
 */
export const live = {
  level: 0, // 0..1 current "energy"
  bump(amount = 0.35) {
    live.level = Math.min(1, live.level + amount)
  },
}

interface Store {
  connected: boolean
  state: JarvisState
  monitor: Monitor | null
  settings: Settings | null
  tools: ToolInfo[]
  messages: Message[]
  streaming: { id: string; text: string; via?: string } | null
  confirm: ConfirmRequest | null
  toast: { id: number; text: string; kind: 'error' | 'info' } | null
  settingsOpen: boolean
  providerStatus: ProviderStatus | null
  version: string
  speaking: boolean
  listening: boolean
  wakeOn: boolean
  wakeArmed: boolean
  wakeStatus: 'off' | 'listening' | 'restarting' | 'no-internet' | 'no-mic'
  wakeHeard: { text: string; at: number } | null
  warm: WarmState
  thinkingSince: number
  /** Last 60 seconds of telemetry for the sparklines. */
  history: { cpu: number[]; ram: number[]; net: number[] }
  /** Time from sending a command to the first word of the reply. */
  latencyMs: number | null
  sentAt: number
  tasks: { id: number; title: string; due: string | null }[]
  micActive: boolean
  helpOpen: boolean

  setConnected(v: boolean): void
  setState(s: JarvisState): void
  setMonitor(m: Monitor): void
  setSettings(s: Settings): void
  setHello(p: { settings: Settings; tools: ToolInfo[]; history: Message[]; version: string }): void
  addMessage(m: Message): void
  setMessages(ms: Message[]): void
  startStream(id: string, via?: string): void
  appendStream(id: string, text: string): void
  endStream(id: string, text: string, via?: string, interrupted?: boolean): void
  setConfirm(c: ConfirmRequest | null): void
  showToast(text: string, kind?: 'error' | 'info'): void
  clearToast(): void
  setSettingsOpen(v: boolean): void
  setProviderStatus(s: ProviderStatus | null): void
  setSpeaking(v: boolean): void
  setListening(v: boolean): void
  setWakeOn(v: boolean): void
  setWakeArmed(v: boolean): void
  setWakeStatus(v: Store['wakeStatus']): void
  setWakeHeard(text: string): void
  setWarm(w: WarmState): void
  markSent(): void
  markFirstWord(): void
  setTasks(t: Store['tasks']): void
  setMicActive(v: boolean): void
  setHelpOpen(v: boolean): void
}

/** What the HUD shows: local voice activity wins over the backend state. */
export function uiState(s: { state: JarvisState; speaking: boolean; listening: boolean; wakeArmed: boolean }): JarvisState {
  if (s.listening || s.wakeArmed) return 'listening'
  if (s.state === 'thinking' || s.state === 'executing' || s.state === 'waiting') return s.state
  if (s.speaking) return 'speaking'
  return s.state
}

let toastSeq = 0

export const useStore = create<Store>((set, get) => ({
  connected: false,
  state: 'idle',
  monitor: null,
  settings: null,
  tools: [],
  messages: [],
  streaming: null,
  confirm: null,
  toast: null,
  settingsOpen: false,
  providerStatus: null,
  version: '',
  speaking: false,
  listening: false,
  wakeOn: false,
  wakeArmed: false,
  wakeStatus: 'off',
  wakeHeard: null,
  warm: { state: 'idle' },
  thinkingSince: 0,
  history: { cpu: [], ram: [], net: [] },
  latencyMs: null,
  sentAt: 0,
  tasks: [],
  micActive: false,
  helpOpen: false,

  setConnected: (connected) => set({ connected }),
  setState: (state) =>
    set({ state, thinkingSince: state === 'thinking' ? get().thinkingSince || Date.now() : state === 'idle' ? 0 : get().thinkingSince }),
  setMonitor: (monitor) => {
    const h = get().history
    const push = (arr: number[], v: number) => (arr.length >= 60 ? [...arr.slice(1), v] : [...arr, v])
    set({
      monitor,
      history: {
        cpu: push(h.cpu, monitor.cpu),
        ram: push(h.ram, monitor.ram.pct),
        net: push(h.net, monitor.net.up_kbps + monitor.net.down_kbps),
      },
    })
  },
  setSettings: (settings) => set({ settings }),
  setHello: ({ settings, tools, history, version }) =>
    set({
      settings,
      tools,
      version,
      messages: history.map((m, i) => ({ ...m, id: `h${i}`, ts: 0 })),
    }),
  addMessage: (m) => set({ messages: [...get().messages, m].slice(-200) }),
  setMessages: (messages) => set({ messages }),
  startStream: (id, via) => set({ streaming: { id, text: '', via } }),
  appendStream: (id, text) => {
    const s = get().streaming
    if (!s || s.id !== id) {
      set({ streaming: { id, text } })
    } else {
      set({ streaming: { ...s, text: s.text + text } })
    }
  },
  endStream: (id, text, via, interrupted) => {
    const s = get().streaming
    const final = text || s?.text || ''
    if (!s && get().messages.some((m) => m.id === id)) return // already finalised locally
    set({
      streaming: null,
      messages: [
        ...get().messages,
        { id, role: 'assistant' as const, text: final, ts: Date.now(), via: via ?? s?.via, interrupted },
      ].slice(-200),
    })
  },
  setConfirm: (confirm) => set({ confirm }),
  showToast: (text, kind = 'error') => set({ toast: { id: ++toastSeq, text, kind } }),
  clearToast: () => set({ toast: null }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setProviderStatus: (providerStatus) => set({ providerStatus }),
  setSpeaking: (speaking) => {
    if (get().speaking !== speaking) set({ speaking })
  },
  setListening: (listening) => set({ listening }),
  setWakeOn: (wakeOn) => set({ wakeOn }),
  setWakeArmed: (wakeArmed) => set({ wakeArmed }),
  setWakeStatus: (wakeStatus) => {
    if (get().wakeStatus !== wakeStatus) set({ wakeStatus })
  },
  setWakeHeard: (text) => set({ wakeHeard: { text, at: Date.now() } }),
  setWarm: (warm) => set({ warm }),
  markSent: () => set({ sentAt: Date.now() }),
  markFirstWord: () => {
    const t = get().sentAt
    if (t) set({ latencyMs: Date.now() - t, sentAt: 0 })
  },
  setTasks: (tasks) => set({ tasks }),
  setMicActive: (micActive) => set({ micActive }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
}))
