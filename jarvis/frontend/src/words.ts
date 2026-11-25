/**
 * Plain-language labels for everything the HUD shows, in the Hinglish the
 * user speaks. Keep technical names (tool ids, model ids) out of sight unless
 * the user hovers for details.
 */
import type { JarvisState } from './types'

export const STATE_WORDS: Record<JarvisState, string> = {
  idle: 'TAIYAAR',
  listening: 'SUN RAHI HOON',
  thinking: 'SOCH RAHI HOON',
  speaking: 'BOL RAHI HOON',
  executing: 'KAAM KAR RAHI HOON',
  waiting: 'AAPKI PERMISSION CHAHIYE',
}

/** One line under the reactor: what is happening, and what you can say now. */
export function stateHint(state: JarvisState, opts: { wakeOn: boolean; name: string; warm: string }): [string, string] {
  const n = opts.name
  switch (state) {
    case 'listening':
      return ['Sun rahi hoon…', 'Apni command boliye, jaise “chrome kholo”']
    case 'thinking':
      return ['Soch rahi hoon…', 'Jawab bas aa raha hai']
    case 'speaking':
      return ['Bol rahi hoon', `Rokna ho toh “${n} stop” boliye`]
    case 'executing':
      return ['Aapka kaam kar rahi hoon', 'Ek second…']
    case 'waiting':
      return ['Aapki permission chahiye', 'Screen par Allow ya Cancel dabaiye']
    default:
      if (opts.warm === 'loading') return ['AI load ho raha hai', 'Tab tak “chrome kholo” jaise commands chalte hain']
      if (opts.wakeOn) return [`“${n}” boliye`, 'Main sun rahi hoon. Ya neeche likhiye']
      return ['Taiyaar', 'Mic dabaiye ya neeche likhiye']
  }
}

const TOOL_WORDS: Record<string, [string, string]> = {
  // tool id: [done, failed]
  get_time: ['Time dekha', 'Time nahi mil paaya'],
  system_status: ['PC ki halat dekhi', 'PC ki halat nahi mil paayi'],
  open_website: ['Website kholi', 'Website nahi khul paayi'],
  open_app: ['App khola', 'App nahi khul paaya'],
  remember: ['Yaad rakh liya', 'Yaad nahi rakh paayi'],
  recall: ['Purani baatein dekhi', 'Yaadein nahi mil paayi'],
  forget: ['Yaad mita di', 'Yaad nahi mit paayi'],
  add_task: ['Kaam joda', 'Kaam nahi jud paaya'],
  list_tasks: ['Kaam ki list dekhi', 'Kaam ki list nahi mil paayi'],
  complete_task: ['Kaam poora kiya', 'Kaam poora mark nahi ho paaya'],
  delete_task: ['Kaam hataya', 'Kaam nahi hat paaya'],
  find_files: ['Files dhoondhi', 'Files nahi dhoondh paayi'],
  open_file: ['File kholi', 'File nahi khul paayi'],
  open_latest_file: ['Sabse nayi file kholi', 'File nahi mil paayi'],
  read_file: ['File padhi', 'File nahi padh paayi'],
  write_file: ['File bana kar save ki', 'File save nahi ho paayi'],
}

export function toolWords(name: string, ok: boolean): string {
  const w = TOOL_WORDS[name]
  if (!w) return ok ? `${name} chalaya` : `${name} nahi chal paaya`
  return ok ? w[0] : w[1]
}

const PROVIDER_WORDS: Record<string, string> = {
  ollama: 'PC ka AI',
  gemini: 'Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  openai_compat: 'Custom AI',
  anthropic: 'Claude',
}

export function providerWords(name: string | undefined): string {
  return name ? (PROVIDER_WORDS[name] ?? name) : '—'
}

/** "gemini:gemini-flash-lite-latest" -> "Gemini se jawab". */
export function viaWords(via: string | undefined): string {
  if (!via) return ''
  if (via === 'direct') return '⚡ Turant · bina AI'
  return `${providerWords(via.split(':')[0])} AI se jawab`
}

export function secondsWords(ms: number | null): string {
  if (ms === null) return '—'
  return ms < 1000 ? `${(ms / 1000).toFixed(1)} sec` : `${(ms / 1000).toFixed(1)} sec`
}

export function uptimeWords(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d} din ${h} ghante`
  if (h) return `${h} ghante ${m} min`
  return `${m} min`
}

/** Example commands shown as one-tap buttons. */
export const EXAMPLES = [
  'chrome kholo',
  'time kya hua',
  'meri latest excel file kholo',
  'mere pending tasks',
  'yaad rakhna meri meeting 5 baje hai',
  'aaj ki technology news batao',
]
