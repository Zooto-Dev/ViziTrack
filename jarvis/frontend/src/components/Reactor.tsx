import { useEffect, useRef, useState } from 'react'
import { live, uiState, useStore } from '../store'
import type { JarvisState } from '../types'
import { micLevel, micSpectrum, startMicLevel, stopMicLevel } from '../voice/level'
import { stateHint } from '../words'

/**
 * The central holographic core. Pure Canvas 2D in one requestAnimationFrame
 * loop: no React re-renders per frame, ~30 fps while idle, 60 while active.
 *
 * Layers (outside -> in): degree scale, segmented arcs, voice waveform ring
 * (real microphone spectrum while listening), radar sweep while thinking,
 * orbiting particles, dashed ring, hexagonal core.
 */
const BARS = 96

interface Palette {
  main: [number, number, number]
  accent: [number, number, number]
  speed: number
}
const PALETTE: Record<JarvisState, Palette> = {
  idle: { main: [0, 229, 255], accent: [120, 200, 255], speed: 0.18 },
  listening: { main: [80, 240, 255], accent: [255, 255, 255], speed: 0.5 },
  thinking: { main: [150, 230, 255], accent: [255, 255, 255], speed: 1.4 },
  speaking: { main: [0, 229, 255], accent: [140, 255, 245], speed: 0.8 },
  executing: { main: [124, 255, 178], accent: [220, 255, 230], speed: 1.0 },
  waiting: { main: [255, 196, 87], accent: [255, 236, 190], speed: 0.35 },
}

const THEME_COLORS: Record<string, { main: [number, number, number]; accent: [number, number, number] }> = {
  stark: { main: [255, 184, 77], accent: [255, 92, 66] },
  minimal: { main: [150, 190, 255], accent: [235, 242, 255] },
  ice: { main: [190, 230, 255], accent: [255, 255, 255] },
  tactical: { main: [64, 255, 128], accent: [200, 255, 215] },
  crimson: { main: [255, 59, 76], accent: [255, 170, 120] },
  vibranium: { main: [176, 120, 255], accent: [225, 205, 255] },
  solar: { main: [255, 140, 40], accent: [255, 220, 120] },
  cyber: { main: [255, 60, 200], accent: [46, 242, 255] },
  daylight: { main: [0, 110, 230], accent: [0, 60, 160] },
}

/** Idle/listening/speaking take the theme colours; status colours stay universal. */
function paletteFor(st: JarvisState): Palette {
  const base = PALETTE[st]
  const theme = THEME_COLORS[document.documentElement.dataset.theme || '']
  if (!theme || st === 'executing' || st === 'waiting') return base
  return { ...base, main: theme.main, accent: st === 'thinking' ? [255, 255, 255] : theme.accent }
}

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

export function Reactor() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<JarvisState>('idle')
  const state = useStore(uiState)
  const warm = useStore((s) => s.warm)
  const wakeOn = useStore((s) => s.wakeOn)
  const listening = useStore((s) => s.listening)
  const name = useStore((s) => s.settings?.assistant_name || 'Friday')
  const heard = useStore((s) => s.wakeHeard)
  const [, tick] = useState(0)
  stateRef.current = state

  // The waveform follows the real microphone while she is listening for you.
  useEffect(() => {
    if (wakeOn || listening) startMicLevel()
    else stopMicLevel()
  }, [wakeOn, listening])
  useEffect(() => () => stopMicLevel(), [])

  useEffect(() => {
    if (!heard) return
    const id = window.setTimeout(() => tick((n) => n + 1), 4100)
    return () => window.clearTimeout(id)
  }, [heard])
  const showHeard = heard && Date.now() - heard.at < 4000

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d', { alpha: true })!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = 0
    let rot = 0
    let sweep = 0
    const bars = new Float32Array(BARS)
    const seed = new Float32Array(BARS).map(() => Math.random())
    const orbits = [
      { r: 1.14, speed: 0.55, phase: 0, size: 2.4 },
      { r: 0.9, speed: -0.8, phase: 2.1, size: 1.8 },
      { r: 1.28, speed: 0.32, phase: 4.2, size: 1.6 },
    ]
    let w = 0
    let h = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      w = rect.width
      h = rect.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      const st = stateRef.current
      const calm = st === 'idle' || reduced
      if (calm && t - last < 33) return // ~30 fps at rest
      const dt = Math.min(0.1, (t - last) / 1000 || 0.016)
      last = t
      const p = paletteFor(st)
      const cx = w / 2
      const cy = h / 2
      const R = Math.min(w, h) * 0.33

      // Energy: real mic level while listening, streamed words while speaking.
      const spec = micSpectrum()
      const mic = spec ? micLevel(spec) : 0
      live.level = Math.max(0, live.level - dt * 1.5)
      const breathe = 0.5 + 0.5 * Math.sin(t / 1600)
      let energy = 0.05 + 0.04 * breathe
      if (st === 'listening') energy = Math.max(0.12, mic)
      else if (st === 'speaking') energy = Math.max(0.15, live.level)
      else if (st === 'thinking' || st === 'executing') energy = 0.3 + 0.1 * Math.sin(t / 180)
      else energy = Math.max(energy, mic * 0.6)
      rot += dt * p.speed
      sweep += dt * (st === 'thinking' ? 2.6 : 0.6)

      ctx.clearRect(0, 0, w, h)

      // Bloom behind everything.
      const glow = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.7)
      glow.addColorStop(0, rgba(p.main, 0.22 + energy * 0.35))
      glow.addColorStop(0.45, rgba(p.main, 0.06 + energy * 0.08))
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)

      // 1. Degree scale: 180 ticks, longer every 10, slowly turning.
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(rot * 0.15)
      for (let i = 0; i < 180; i++) {
        const a = (i / 180) * Math.PI * 2
        const major = i % 15 === 0
        const r0 = R * 1.36
        const len = major ? R * 0.07 : i % 5 === 0 ? R * 0.035 : R * 0.018
        ctx.strokeStyle = rgba(p.main, major ? 0.75 : 0.28)
        ctx.lineWidth = major ? 1.6 : 1
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
        ctx.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len))
        ctx.stroke()
      }
      ctx.restore()

      // 2. Outer segmented arcs with gradient tails.
      const segs = [
        { r: 1.22, n: 3, fill: 0.55, dir: 1, lw: 2.5, speed: 0.6 },
        { r: 1.04, n: 8, fill: 0.7, dir: -1, lw: 1.2, speed: 0.9 },
        { r: 0.66, n: 4, fill: 0.42, dir: 1, lw: 4, speed: 1.3 },
      ]
      for (const s of segs) {
        const span = (Math.PI * 2) / s.n
        const base = rot * s.dir * s.speed
        ctx.lineWidth = s.lw
        ctx.lineCap = 'round'
        for (let i = 0; i < s.n; i++) {
          const a0 = base + i * span
          ctx.strokeStyle = rgba(p.main, 0.35 + energy * 0.6)
          ctx.beginPath()
          ctx.arc(cx, cy, R * s.r, a0, a0 + span * s.fill)
          ctx.stroke()
        }
      }

      // 3. Voice waveform ring (mirrored so it is symmetric).
      for (let i = 0; i < BARS; i++) {
        const half = i < BARS / 2 ? i : BARS - 1 - i
        let target: number
        if (spec && (st === 'listening' || mic > 0.08)) {
          const bin = 2 + Math.floor((half / (BARS / 2)) * 40)
          target = (spec[bin] / 255) * 1.2
        } else if (st === 'idle') {
          target = 0.08 + 0.06 * Math.sin(t / 700 + half * 0.35)
        } else {
          target = energy * (0.45 + 0.55 * Math.abs(Math.sin(t / 110 + half * 0.55 + seed[half] * 5)))
        }
        bars[i] += (target - bars[i]) * Math.min(1, dt * 14)
      }
      ctx.lineCap = 'round'
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2
        const r0 = R * 0.8
        const len = R * 0.24 * bars[i] + 2
        ctx.strokeStyle = rgba(i % 2 ? p.main : p.accent, 0.3 + Math.min(0.7, bars[i]))
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
        ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len))
        ctx.stroke()
      }

      // 4. Radar sweep (strong while thinking, faint otherwise).
      if (!reduced && 'createConicGradient' in ctx) {
        const cg = ctx.createConicGradient(sweep, cx, cy)
        const a = st === 'thinking' ? 0.32 : 0.07
        cg.addColorStop(0, rgba(p.main, a))
        cg.addColorStop(0.12, rgba(p.main, 0))
        cg.addColorStop(1, rgba(p.main, 0))
        ctx.fillStyle = cg
        ctx.beginPath()
        ctx.arc(cx, cy, R * 0.78, 0, Math.PI * 2)
        ctx.fill()
      }

      // 5. Thin guide rings.
      ctx.lineWidth = 1
      for (const [k, a] of [
        [1.32, 0.16],
        [0.78, 0.22],
        [0.52, 0.18],
      ] as const) {
        ctx.strokeStyle = rgba(p.main, a)
        ctx.beginPath()
        ctx.arc(cx, cy, R * k, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.setLineDash([2, 6])
      ctx.strokeStyle = rgba(p.main, 0.45)
      ctx.beginPath()
      ctx.arc(cx, cy, R * 0.44, rot * -1.4, rot * -1.4 + Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])

      // 6. Orbiting particles with short trails.
      for (const o of orbits) {
        const ang = o.phase + t / 1000 * o.speed * (1 + energy)
        for (let k = 0; k < 6; k++) {
          const ta = ang - k * 0.05 * Math.sign(o.speed)
          ctx.fillStyle = rgba(p.accent, (1 - k / 6) * 0.8)
          ctx.beginPath()
          ctx.arc(cx + Math.cos(ta) * R * o.r, cy + Math.sin(ta) * R * o.r, o.size * (1 - k / 8), 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // 7. Hexagonal core.
      const coreR = R * (0.24 + energy * 0.05)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(rot * 0.5)
      ctx.strokeStyle = rgba(p.main, 0.85)
      ctx.lineWidth = 1.6
      ctx.beginPath()
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2
        const x = Math.cos(a) * coreR * 1.15
        const y = Math.sin(a) * coreR * 1.15
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.restore()
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
      core.addColorStop(0, 'rgba(255,255,255,0.98)')
      core.addColorStop(0.25, rgba(p.accent, 0.95))
      core.addColorStop(0.6, rgba(p.main, 0.55))
      core.addColorStop(1, rgba(p.main, 0))
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
      ctx.fill()
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const [line, hint] = stateHint(state, { wakeOn, name, warm: warm.state })

  return (
    <div className="reactor-wrap">
      <canvas ref={canvasRef} className="reactor" aria-label="FRIDAY core visualisation" />
      {showHeard && <div className="reactor-heard">Suna: “{heard.text}”</div>}
      <div className={`reactor-status s-${state}`}>
        <div className="rs-line">{line}</div>
        <div className="rs-hint">{hint}</div>
      </div>
    </div>
  )
}
