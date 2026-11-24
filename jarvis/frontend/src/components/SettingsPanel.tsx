import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { api } from '../ws'
import { listVoices, speaker, ttsSupported } from '../voice/tts'

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const status = useStore((s) => s.providerStatus)
  const tools = useStore((s) => s.tools)
  const [draft, setDraft] = useState(() => settings)
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => listVoices())

  useEffect(() => {
    if (!ttsSupported) return
    const refresh = () => setVoices(listVoices())
    window.speechSynthesis.addEventListener('voiceschanged', refresh)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh)
  }, [])

  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])

  if (!draft || !settings) return null
  const presets = settings.provider_presets
  const preset = presets[draft.provider.name]

  const changeProvider = (name: string) => {
    const p = presets[name]
    setDraft({ ...draft, provider: { ...draft.provider, name, base_url: p.base_url, model: p.model } })
  }

  const save = async () => {
    const patch: Record<string, unknown> = {
      user_name: draft.user_name,
      assistant_name: draft.assistant_name,
      reply_language: draft.reply_language,
      confirm_all_system_actions: draft.confirm_all_system_actions,
      voice: {
        speak_replies: draft.voice.speak_replies,
        tts_voice: draft.voice.tts_voice,
        tts_rate: draft.voice.tts_rate,
        stt_lang: draft.voice.stt_lang,
        wake_enabled: draft.voice.wake_enabled,
        tts_mode: draft.voice.tts_mode,
      },
      provider: {
        name: draft.provider.name,
        base_url: draft.provider.base_url,
        model: draft.provider.model,
        max_tokens: draft.provider.max_tokens,
        ...(key ? { api_key: key } : {}),
      },
    }
    api.setSettings(patch)
    setKey('')
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
  }

  const test = async () => {
    setTesting(true)
    await save()
    await new Promise((r) => setTimeout(r, 150)) // let the settings round-trip
    await api.testProvider()
    setTesting(false)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          SETTINGS
          <button className="x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <section>
          <h3>AI PROVIDER</h3>
          <label>
            Provider
            <select value={draft.provider.name} onChange={(e) => changeProvider(e.target.value)}>
              {Object.entries(presets).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {preset?.kind !== 'anthropic' && (
            <label>
              Server URL
              <input
                value={draft.provider.base_url}
                onChange={(e) => setDraft({ ...draft, provider: { ...draft.provider, base_url: e.target.value } })}
              />
            </label>
          )}
          <label>
            Model
            <input
              list="models"
              value={draft.provider.model}
              onChange={(e) => setDraft({ ...draft, provider: { ...draft.provider, model: e.target.value } })}
            />
            <datalist id="models">{status?.models?.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          {preset?.needs_key && (
            <label>
              API key {settings.provider.has_key && <span className="dim">(saved: {settings.provider.api_key})</span>}
              <input
                type="password"
                placeholder={settings.provider.has_key ? 'leave blank to keep the saved key' : 'paste your key'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          <div className="row">
            <button className="btn" onClick={test} disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {status && (
              <span className={`status ${status.ok ? 'ok' : 'bad'}`}>
                {status.ok ? '●' : '●'} {status.detail}
              </span>
            )}
          </div>
          {draft.provider.name === 'ollama' && (
            <p className="hint">
              Free and offline. Install Ollama from ollama.com, then in a terminal run <code>ollama pull {draft.provider.model || 'qwen2.5:7b'}</code>.
              Models that support tools: qwen2.5, llama3.1, llama3.2, mistral-nemo.
            </p>
          )}
          {draft.provider.name === 'groq' && <p className="hint">Free key at console.groq.com. Very fast; generous free limits.</p>}
          {draft.provider.name === 'gemini' && <p className="hint">Free key at aistudio.google.com.</p>}
          {draft.provider.name === 'openrouter' && <p className="hint">Key at openrouter.ai. Models ending in “:free” cost nothing.</p>}
        </section>

        <section>
          <h3>VOICE</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.voice.speak_replies}
              onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, speak_replies: e.target.checked } })}
            />
            {draft.assistant_name} jawab bol kar sunaye
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.voice.wake_enabled}
              onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, wake_enabled: e.target.checked } })}
            />
            Wake word: “{draft.assistant_name}”, “Hey {draft.assistant_name}” ya “Wake up” bolne par apne aap sune
          </label>
          <label>
            Awaaz ki quality
            <select
              value={draft.voice.tts_mode}
              onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, tts_mode: e.target.value as 'natural' | 'fast' } })}
            >
              <option value="natural">Natural (insaan jaisi, online, ~1 second der)</option>
              <option value="fast">Fast (turant, offline, thodi robotic)</option>
            </select>
          </label>
          <div className="grid2">
            <label>
              {draft.assistant_name} ki awaaz
              <select
                value={draft.voice.tts_voice}
                onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, tts_voice: e.target.value } })}
              >
                <option value="">Auto (best available)</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} · {v.lang}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Aap kis bhasha me bologe
              <select
                value={draft.voice.stt_lang}
                onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, stt_lang: e.target.value } })}
              >
                <option value="en-IN">English / Hinglish</option>
                <option value="hi-IN">Hindi</option>
              </select>
            </label>
          </div>
          <label>
            Bolne ki speed: {draft.voice.tts_rate.toFixed(2)}×
            <input
              type="range"
              min={0.8}
              max={1.4}
              step={0.05}
              value={draft.voice.tts_rate}
              onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, tts_rate: Number(e.target.value) } })}
            />
          </label>
          <div className="row">
            <button
              className="btn"
              disabled={!ttsSupported}
              onClick={() =>
                speaker.preview(
                  `Hello ${draft.user_name}. Main ${draft.assistant_name} hoon. Sab systems online hain.`,
                  draft.voice.tts_voice,
                  draft.voice.tts_rate,
                  draft.voice.tts_mode,
                )
              }
            >
              ▶ Awaaz test karo
            </button>
            {!ttsSupported && <span className="status bad">Is browser me awaaz support nahi hai.</span>}
          </div>
          <p className="hint">
            Sabse natural awaaz Microsoft Edge me milti hai (“Online (Natural)” wali). Mic aur wake word ke liye internet chahiye. Wake word on ho toh mic lagataar sunta hai (sirf jab tak ye window khuli hai). Shortcut: Ctrl+Space.
          </p>
        </section>

        <section>
          <h3>PERSONA</h3>
          <div className="grid2">
            <label>
              Call me
              <input value={draft.user_name} onChange={(e) => setDraft({ ...draft, user_name: e.target.value })} />
            </label>
            <label>
              Assistant name
              <input value={draft.assistant_name} onChange={(e) => setDraft({ ...draft, assistant_name: e.target.value })} />
            </label>
          </div>
          <label>
            Reply language
            <select
              value={draft.reply_language}
              onChange={(e) => setDraft({ ...draft, reply_language: e.target.value as typeof draft.reply_language })}
            >
              <option value="auto">Auto (mirror me: Hindi / English / Hinglish)</option>
              <option value="hinglish">Always Hinglish</option>
              <option value="hindi">Always Hindi</option>
              <option value="english">Always English</option>
            </select>
          </label>
        </section>

        <section>
          <h3>PERMISSIONS</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.confirm_all_system_actions}
              onChange={(e) => setDraft({ ...draft, confirm_all_system_actions: e.target.checked })}
            />
            Ask before every system action (opening apps, websites). Destructive actions always ask.
          </label>
          <details>
            <summary className="dim">{tools.length} tools available</summary>
            <ul className="tools">
              {tools.map((t) => (
                <li key={t.name}>
                  <span className="mono">{t.name}</span>
                  <span className={`risk ${t.risk}`}>{t.risk}</span>
                  <span className="dim">{t.description}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-send" onClick={save}>
            {saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
