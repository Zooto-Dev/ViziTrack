import { useEffect, useRef } from 'react'
import { live, uiState, useStore } from '../store'
import type { JarvisState } from '../types'

/**
 * The central "arc reactor": concentric rings, rotating segment arcs and a
 * circular waveform. Pure Canvas 2D, one requestAnimationFrame loop, no React
 * re-renders. The loop drops to ~20fps while idle to save CPU/battery.
 */
const BARS = 72

const PALETTE: Record<JarvisState, { core: string; ring: string; glow: string; speed: number }> = {
  idle: { core: '#00e5ff', ring: 'rgba(0,229,255,0.55)', glow: 'rgba(0,229,255,0.25)', speed: 0.25 },
  listening: { core: '#5cf2ff', ring: 'rgba(92,242,255,0.9)', glow: 'rgba(92,242,255,0.45)', speed: 0.6 },
  thinking: { core: '#ffffff', ring: 'rgba(160,240,255,0.95)', glow: 'rgba(0,229,255,0.5)', speed: 1.8 },
  speaking: { core: '#00e5ff', ring: 'rgba(0,229,255,1)', glow: 'rgba(0,229,255,0.55)', speed: 0.9 },
  executing: { core: '#7CFFB2', ring: 'rgba(124,255,178,0.95)', glow: 'rgba(124,255,178,0.45)', speed: 1.2 },
  waiting: { core: '#ffd166', ring: 'rgba(255,209,102,0.95)', glow: 'rgba(255,209,102,0.4)', speed: 0.4 },
}

export function Reactor() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<JarvisState>('idle')
  const state = useStore(uiState)
  const warm = useStore((s) => s.warm)
  stateRef.current = state

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d', { alpha: true })!
    let raf = 0
    let last = 0
    let rot = 0
    const bars = new Float32Array(BARS)
    const noise = new Float32Array(BARS).map(() => Math.random())
    let w = 0
    let h = 0
    let dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
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
      const idle = st === 'idle'
      // Throttle when idle.
      if (idle && t - last < 50) return
      const dt = Math.min(0.1, (t - last) / 1000 || 0.016)
      last = t
      const p = PALETTE[st]
      const cx = w / 2
      const cy = h / 2
      const R = Math.min(w, h) * 0.36

      // energy decays; idle breathes gently
      live.level = Math.max(0, live.level - dt * 1.6)
      const breathe = 0.5 + 0.5 * Math.sin(t / 1400)
      const energy = idle ? 0.06 + 0.05 * breathe : Math.max(st === 'thinking' ? 0.25 : 0.12, live.level)
      rot += dt * p.speed

      ctx.clearRect(0, 0, w, h)

      // outer glow
      const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.45)
      g.addColorStop(0, p.glow)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.globalAlpha = 0.35 + energy * 0.5
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = 1

      // waveform ring
      for (let i = 0; i < BARS; i++) {
        const target = idle
          ? 0.15 + 0.1 * Math.sin(t / 600 + i * 0.4)
          : energy * (0.5 + 0.5 * Math.sin(t / 90 + i * 0.9 + noise[i] * 6)) + 0.08
        bars[i] += (target - bars[i]) * Math.min(1, dt * 12)
      }
      ctx.lineCap = 'round'
      ctx.lineWidth = 2.2
      ctx.strokeStyle = p.ring
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2
        const r0 = R * 0.78
        const len = R * 0.22 * bars[i] + 3
        ctx.globalAlpha = 0.35 + bars[i] * 0.65
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
        ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len))
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // thin static rings
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(0,229,255,0.18)'
      for (const k of [1.08, 0.74, 0.5]) {
        ctx.beginPath()
        ctx.arc(cx, cy, R * k, 0, Math.PI * 2)
        ctx.stroke()
      }

      // rotating segmented arcs
      const segs = [
        { r: 1.0, n: 6, gap: 0.35, dir: 1, lw: 3 },
        { r: 0.62, n: 3, gap: 0.5, dir: -1, lw: 5 },
        { r: 0.42, n: 12, gap: 0.6, dir: 1, lw: 1.5 },
      ]
      ctx.strokeStyle = p.ring
      for (const s of segs) {
        ctx.lineWidth = s.lw
        const span = (Math.PI * 2) / s.n
        const base = rot * s.dir * (1.4 - s.r)
        for (let i = 0; i < s.n; i++) {
          const a0 = base + i * span
          ctx.globalAlpha = 0.5 + 0.5 * energy
          ctx.beginPath()
          ctx.arc(cx, cy, R * s.r, a0, a0 + span * (1 - s.gap))
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1

      // core
      const coreR = R * (0.2 + energy * 0.06)
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
      cg.addColorStop(0, '#ffffff')
      cg.addColorStop(0.35, p.core)
      cg.addColorStop(1, 'rgba(0,229,255,0)')
      ctx.fillStyle = cg
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

  return (
    <div className="reactor-wrap">
      <canvas ref={canvasRef} className="reactor" aria-label="Jarvis core visualisation" />
      <div className="reactor-caption mono">
        {state !== 'idle'
          ? state.toUpperCase()
          : warm.state === 'loading'
            ? 'LOADING AI MODEL…'
            : warm.state === 'failed'
              ? 'AI MODEL OFFLINE · COMMANDS STILL WORK'
              : 'READY'}
      </div>
    </div>
  )
}
