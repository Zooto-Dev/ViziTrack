/**
 * Alternative centre visuals for the reactor canvas. Each one draws a single
 * frame from the shared inputs (colours, energy 0..1, microphone spectrum),
 * so they all react to the voice the same way and cost about the same.
 */
export type RGB = [number, number, number]

export interface Frame {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  t: number // ms
  dt: number // s
  state: string
  main: RGB
  accent: RGB
  energy: number // 0..1
  spec: Uint8Array | null // mic spectrum while listening
  mem: Record<string, unknown> // per-visual scratch that survives frames
}

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

function bloom(f: Frame, cx: number, cy: number, r: number, strength: number) {
  const g = f.ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, rgba(f.main, strength))
  g.addColorStop(1, 'rgba(0,0,0,0)')
  f.ctx.fillStyle = g
  f.ctx.fillRect(0, 0, f.w, f.h)
}

/** Spectrum value 0..1 at position x in 0..1 (voice band), or a calm fallback. */
function voiceAt(f: Frame, x: number): number {
  if (f.spec && (f.state === 'listening' || f.energy > 0.1)) {
    const bin = 2 + Math.floor(Math.min(1, Math.max(0, x)) * 44)
    return f.spec[bin] / 255
  }
  return 0
}

/* ---------------------------------------------------------------- orb ---- */
/** Soft plasma sphere: glowing blobs drift inside, the rim ripples with the voice. */
export function drawOrb(f: Frame) {
  const { ctx, w, h, t, energy } = f
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.27 * (1 + energy * 0.12)
  bloom(f, cx, cy, R * 2.6, 0.18 + energy * 0.3)

  // Rippling rim.
  ctx.save()
  ctx.beginPath()
  const n = 120
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const v = voiceAt(f, Math.abs(Math.sin(a)))
    const wobble =
      Math.sin(a * 3 + t / 900) * 0.012 + Math.sin(a * 5 - t / 600) * 0.012 * (0.3 + energy) + v * 0.07
    const r = R * (1 + wobble)
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  const body = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.1)
  body.addColorStop(0, rgba(f.accent, 0.55))
  body.addColorStop(0.5, rgba(f.main, 0.28))
  body.addColorStop(1, rgba(f.main, 0.06))
  ctx.fillStyle = body
  ctx.fill()
  ctx.strokeStyle = rgba(f.main, 0.7)
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.clip()

  // Drifting plasma blobs inside.
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 5; i++) {
    const sp = 0.00025 * (i + 2)
    const bx = cx + Math.cos(t * sp + i * 1.7) * R * 0.45
    const by = cy + Math.sin(t * sp * 1.3 + i) * R * 0.45
    const br = R * (0.45 + 0.15 * Math.sin(t / 900 + i))
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br)
    g.addColorStop(0, rgba(i % 2 ? f.accent : f.main, 0.22 + energy * 0.25))
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6)
  }
  ctx.restore()

  // Specular highlight.
  const hl = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, 0, cx - R * 0.35, cy - R * 0.4, R * 0.5)
  hl.addColorStop(0, 'rgba(255,255,255,0.35)')
  hl.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hl
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()

  // Outer halo: a thin ring and a slow orbiting arc.
  ctx.strokeStyle = rgba(f.main, 0.2)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.32, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = rgba(f.accent, 0.55 + energy * 0.4)
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  const a0 = t / 1800
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.32, a0, a0 + 0.9)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.32, a0 + Math.PI, a0 + Math.PI + 0.5)
  ctx.stroke()
}

/* --------------------------------------------------------------- wave ---- */
/** No circle at all: layered sound waves across the centre. */
export function drawWave(f: Frame) {
  const { ctx, w, h, t, energy } = f
  const cy = h / 2
  const x0 = w * 0.08
  const x1 = w * 0.92
  const span = x1 - x0
  const amp = h * (0.03 + energy * 0.22)
  bloom(f, w / 2, cy, Math.min(w, h) * 0.7, 0.12 + energy * 0.25)

  const layers = [
    { f: 1.6, sp: 0.0021, a: 1, lw: 2.6, c: f.main, al: 0.95 },
    { f: 2.4, sp: -0.0016, a: 0.7, lw: 1.6, c: f.accent, al: 0.6 },
    { f: 3.3, sp: 0.0011, a: 0.45, lw: 1.2, c: f.main, al: 0.4 },
  ]
  for (const L of layers) {
    ctx.beginPath()
    for (let i = 0; i <= 160; i++) {
      const u = i / 160
      const env = Math.sin(u * Math.PI) ** 1.6 // taper at both ends
      const v = voiceAt(f, u)
      const y = cy + Math.sin(u * Math.PI * 2 * L.f + t * L.sp) * amp * L.a * env * (1 + v * 2.2)
      const x = x0 + u * span
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    const g = ctx.createLinearGradient(x0, 0, x1, 0)
    g.addColorStop(0, rgba(L.c, 0))
    g.addColorStop(0.5, rgba(L.c, L.al))
    g.addColorStop(1, rgba(L.c, 0))
    ctx.strokeStyle = g
    ctx.lineWidth = L.lw
    ctx.stroke()
  }

  // Mirrored level bars under the wave.
  const bars = 48
  for (let i = 0; i < bars; i++) {
    const u = (i + 0.5) / bars
    const v = Math.max(voiceAt(f, Math.abs(u - 0.5) * 2), energy * (0.3 + 0.7 * Math.abs(Math.sin(t / 160 + i * 0.7))))
    const bh = 3 + v * h * 0.12
    const x = x0 + u * span
    ctx.fillStyle = rgba(f.main, 0.15 + v * 0.5)
    ctx.fillRect(x - 2, cy + h * 0.2 - bh / 2, 4, bh)
  }
  // Baseline.
  const base = ctx.createLinearGradient(x0, 0, x1, 0)
  base.addColorStop(0, rgba(f.main, 0))
  base.addColorStop(0.5, rgba(f.main, 0.35))
  base.addColorStop(1, rgba(f.main, 0))
  ctx.fillStyle = base
  ctx.fillRect(x0, cy, span, 1)
}

/* -------------------------------------------------------------- globe ---- */
/** Rotating 3D sphere of points; points push outward with the voice. */
export function drawGlobe(f: Frame) {
  const { ctx, w, h, t, energy } = f
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.3 * (1 + energy * 0.08)
  bloom(f, cx, cy, R * 2.2, 0.14 + energy * 0.28)

  let pts = f.mem.pts as Float32Array | undefined
  const N = 720
  if (!pts) {
    pts = new Float32Array(N * 3)
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const th = golden * i
      pts[i * 3] = Math.cos(th) * r
      pts[i * 3 + 1] = y
      pts[i * 3 + 2] = Math.sin(th) * r
    }
    f.mem.pts = pts
  }
  const rotY = t / 4200
  const tilt = 0.35
  const cyR = Math.cos(rotY)
  const syR = Math.sin(rotY)
  const ct = Math.cos(tilt)
  const stt = Math.sin(tilt)
  for (let i = 0; i < N; i++) {
    let x = pts[i * 3]
    let y = pts[i * 3 + 1]
    let z = pts[i * 3 + 2]
    // rotate Y then X
    const x1 = x * cyR + z * syR
    const z1 = -x * syR + z * cyR
    const y1 = y * ct - z1 * stt
    const z2 = y * stt + z1 * ct
    x = x1
    y = y1
    z = z2
    const v = voiceAt(f, (i % 45) / 45)
    const push = 1 + v * 0.22 + energy * 0.05 * Math.sin(t / 200 + i)
    const depth = (z + 1) / 2 // 0 back .. 1 front
    const size = 1.1 + depth * 2.3
    ctx.fillStyle = rgba(depth > 0.55 ? f.accent : f.main, 0.25 + depth * 0.75)
    ctx.fillRect(cx + x * R * push - size / 2, cy + y * R * push - size / 2, size, size)
  }
  // Equator and meridian hints.
  ctx.strokeStyle = rgba(f.main, 0.22)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.ellipse(cx, cy, R * 1.02, R * 1.02 * Math.abs(stt), 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(cx, cy, R * 1.02 * Math.abs(syR), R * 1.02, 0, 0, Math.PI * 2)
  ctx.stroke()
  // Core glow.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.35)
  core.addColorStop(0, rgba(f.accent, 0.35 + energy * 0.4))
  core.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = core
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
}

/* ---------------------------------------------------------------- arc ---- */
/** Tony Stark's chest arc reactor: coils, inner ring, triangle, bright core. */
export function drawArc(f: Frame) {
  const { ctx, w, h, t, energy } = f
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.3
  bloom(f, cx, cy, R * 2, 0.22 + energy * 0.35)

  // Housing.
  ctx.lineWidth = R * 0.06
  ctx.strokeStyle = 'rgba(120,130,140,0.35)'
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 1.2
  ctx.strokeStyle = rgba(f.main, 0.5)
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2)
  ctx.stroke()

  // Ten coils.
  const coils = 10
  for (let i = 0; i < coils; i++) {
    const a = (i / coils) * Math.PI * 2 + t / 20000
    const v = voiceAt(f, i / coils)
    const glow = 0.35 + energy * 0.5 + v * 0.4 + 0.1 * Math.sin(t / 300 + i)
    ctx.save()
    ctx.translate(cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78)
    ctx.rotate(a)
    const cw = R * 0.22
    const ch = R * 0.36
    ctx.fillStyle = 'rgba(30,36,40,0.9)'
    ctx.fillRect(-cw / 2, -ch / 2, cw, ch)
    ctx.fillStyle = rgba(f.main, Math.min(1, glow))
    for (let k = 0; k < 5; k++) ctx.fillRect(-cw / 2 + 2, -ch / 2 + 3 + k * (ch / 5), cw - 4, ch / 10)
    ctx.restore()
  }

  // Inner ring and triangle.
  ctx.strokeStyle = rgba(f.accent, 0.8)
  ctx.lineWidth = R * 0.035
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.52, 0, Math.PI * 2)
  ctx.stroke()
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(Math.PI / 2)
  ctx.strokeStyle = rgba(f.main, 0.9)
  ctx.lineWidth = R * 0.05
  ctx.beginPath()
  for (let i = 0; i <= 3; i++) {
    const a = (i / 3) * Math.PI * 2
    const x = Math.cos(a) * R * 0.42
    const y = Math.sin(a) * R * 0.42
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.restore()

  // Core.
  const cr = R * (0.24 + energy * 0.06)
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.4, rgba(f.accent, 0.9))
  core.addColorStop(1, rgba(f.main, 0))
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(cx, cy, cr, 0, Math.PI * 2)
  ctx.fill()
}

/* ---------------------------------------------------------------- hex ---- */
/** Honeycomb that lights up in ripples from the centre; louder voice, brighter cells. */
export function drawHex(f: Frame) {
  const { ctx, w, h, t, energy } = f
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.38
  const s = Math.max(9, R / 9) // hex radius
  bloom(f, cx, cy, R * 1.6, 0.12 + energy * 0.28)
  const dx = s * Math.sqrt(3)
  const dy = s * 1.5
  const rows = Math.ceil(R / dy) + 1
  const cols = Math.ceil(R / dx) + 1
  for (let r = -rows; r <= rows; r++) {
    for (let c = -cols; c <= cols; c++) {
      const x = cx + c * dx + (r & 1 ? dx / 2 : 0)
      const y = cy + r * dy
      const d = Math.hypot(x - cx, y - cy) / R
      if (d > 1) continue
      const ripple = 0.5 + 0.5 * Math.sin(d * 9 - t / (f.state === 'thinking' ? 160 : 420))
      const v = voiceAt(f, d)
      const light = Math.min(1, (1 - d) * 0.35 + ripple * (0.15 + energy * 0.6) + v * 0.7)
      ctx.beginPath()
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3
        const px = x + Math.cos(a) * s * 0.88
        const py = y + Math.sin(a) * s * 0.88
        if (k === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fillStyle = rgba(f.main, light * 0.45)
      ctx.fill()
      ctx.strokeStyle = rgba(light > 0.6 ? f.accent : f.main, 0.25 + light * 0.5)
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 2.2)
  core.addColorStop(0, 'rgba(255,255,255,0.95)')
  core.addColorStop(0.5, rgba(f.accent, 0.6))
  core.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = core
  ctx.fillRect(cx - s * 3, cy - s * 3, s * 6, s * 6)
}

export const VISUALS: Record<string, (f: Frame) => void> = {
  orb: drawOrb,
  wave: drawWave,
  globe: drawGlobe,
  arc: drawArc,
  hex: drawHex,
}
