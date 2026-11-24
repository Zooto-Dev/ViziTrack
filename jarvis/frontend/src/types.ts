export type JarvisState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'executing' | 'waiting'

export interface Monitor {
  ts: number
  cpu: number
  cpu_cores: number
  ram: { used_gb: number; total_gb: number; pct: number }
  net: { up_kbps: number; down_kbps: number }
  disk_pct: number | null
  battery: { percent: number; plugged: boolean } | null
  uptime_s: number
  os: string
}

export interface ProviderPreset {
  label: string
  base_url: string
  model: string
  needs_key: boolean
  kind: string
}

export interface Settings {
  user_name: string
  assistant_name: string
  reply_language: 'auto' | 'english' | 'hindi' | 'hinglish'
  provider: {
    name: string
    base_url: string
    model: string
    api_key: string // masked
    has_key: boolean
    max_tokens: number
    timeout_s: number
  }
  voice: { speak_replies: boolean; tts_voice: string; tts_rate: number; stt_lang: string; wake_word: string }
  confirm_all_system_actions: boolean
  history_limit: number
  provider_presets: Record<string, ProviderPreset>
}

export interface ToolInfo {
  name: string
  description: string
  risk: 'safe' | 'confirm'
  category: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'error'
  text: string
  ts: number
  via?: string
  // tool messages
  name?: string
  ok?: boolean
  args?: Record<string, unknown>
  ms?: number
  interrupted?: boolean
}

export interface ConfirmRequest {
  request_id: string
  tool: string
  args: Record<string, unknown>
  reason: string
}

export interface ProviderStatus {
  ok: boolean
  detail: string
  provider: string
  model: string
  models?: string[]
}

export interface WarmState {
  state: 'idle' | 'loading' | 'ready' | 'failed'
  model?: string
  ms?: number
}
