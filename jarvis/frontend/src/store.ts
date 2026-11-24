import { create } from 'zustand'
import type { ConfirmRequest, JarvisState, Message, Monitor, ProviderStatus, Settings, ToolInfo } from './types'

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

  setConnected: (connected) => set({ connected }),
  setState: (state) => set({ state }),
  setMonitor: (monitor) => set({ monitor }),
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
}))
