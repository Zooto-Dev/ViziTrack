import { memo } from 'react'
import { useStore } from '../store'
import type { Monitor } from '../types'
import { uptimeWords } from '../words'

/** Radial gauge made of 32 segments; lit segments show the value. */
const SegGauge = memo(function SegGauge({ label, pct, sub, warn }: { label: string; pct: number; sub: string; warn?: number }) {
  const v = Math.max(0, Math.min(100, pct))
  const n = 32
  const lit = Math.round((v / 100) * n)
  const hot = warn !== undefined && v >= warn
  const segs = []
  for (let i = 0; i < n; i++) {
    const a0 = (135 + (i / n) * 270) * (Math.PI / 180)
    const a1 = (135 + ((i + 0.72) / n) * 270) * (Math.PI / 180)
    const r0 = 26
    const r1 = 31
    const d = [
      `M ${32 + Math.cos(a0) * r0} ${32 + Math.sin(a0) * r0}`,
      `L ${32 + Math.cos(a0) * r1} ${32 + Math.sin(a0) * r1}`,
      `A ${r1} ${r1} 0 0 1 ${32 + Math.cos(a1) * r1} ${32 + Math.sin(a1) * r1}`,
      `L ${32 + Math.cos(a1) * r0} ${32 + Math.sin(a1) * r0}`,
      `A ${r0} ${r0} 0 0 0 ${32 + Math.cos(a0) * r0} ${32 + Math.sin(a0) * r0}`,
      'Z',
    ].join(' ')
    segs.push(<path key={i} d={d} className={i < lit ? 'seg on' : 'seg'} />)
  }
  return (
    <div className={`sgauge ${hot ? 'hot' : ''}`}>
      <svg viewBox="0 0 64 64" aria-hidden>
        {segs}
        <text x="32" y="34" textAnchor="middle" className="sg-num">
          {Math.round(v)}
        </text>
        <text x="32" y="44" textAnchor="middle" className="sg-unit">
          %
        </text>
      </svg>
      <div className="sg-label">{label}</div>
      <div className="sg-sub mono">{sub}</div>
    </div>
  )
})

function Spark({ data, max, label, value }: { data: number[]; max?: number; label: string; value: string }) {
  const top = max ?? Math.max(1, ...data)
  const pts = data.map((v, i) => `${(i / 59) * 100},${28 - (Math.min(v, top) / top) * 26}`).join(' ')
  const area = data.length ? `0,30 ${pts} ${((data.length - 1) / 59) * 100},30` : ''
  return (
    <div className="spark">
      <div className="spark-head">
        <span>{label}</span>
        <span className="mono">{value}</span>
      </div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
        <polygon points={area} className="spark-area" />
        <polyline points={pts} className="spark-line" />
      </svg>
    </div>
  )
}

function rate(kbps: number) {
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${Math.round(kbps)} KB/s`
}

/** One sentence anyone can read: is the computer fine? */
function health(m: Monitor): { text: string; level: 'ok' | 'warn' | 'bad' } {
  if (m.cpu >= 90 || m.ram.pct >= 92) return { text: 'PC par bahut load hai. Kuch apps band karein.', level: 'bad' }
  if (m.disk_pct !== null && m.disk_pct >= 92) return { text: 'Storage lagbhag full hai. Faltu files hatayein.', level: 'bad' }
  if (m.cpu >= 70 || m.ram.pct >= 80) return { text: 'PC thoda busy hai, par theek chal raha hai.', level: 'warn' }
  return { text: 'PC aaram se chal raha hai.', level: 'ok' }
}

export function SystemMonitor() {
  const m = useStore((s) => s.monitor)
  const hist = useStore((s) => s.history)
  const h = m ? health(m) : null
  return (
    <div className="panel">
      <div className="panel-title">
        <span>PC KI HALAT</span>
        <span className="tag live">● LIVE</span>
      </div>
      {!m || !h ? (
        <div className="dim">Jaankari aa rahi hai…</div>
      ) : (
        <>
          <div className={`health ${h.level}`}>{h.text}</div>
          <div className="sgauges">
            <SegGauge label="PROCESSOR" pct={m.cpu} sub="kitna kaam" warn={85} />
            <SegGauge label="RAM" pct={m.ram.pct} sub={`${m.ram.used_gb} / ${m.ram.total_gb} GB`} warn={90} />
            <SegGauge label="STORAGE" pct={m.disk_pct ?? 0} sub={m.battery ? `Battery ${Math.round(m.battery.percent)}%` : 'C: drive bhari'} warn={92} />
          </div>
          <Spark data={hist.cpu} max={100} label="Processor · pichhla 1 minute" value={`${Math.round(m.cpu)}%`} />
          <Spark data={hist.net} label="Internet · pichhla 1 minute" value={`↓ ${rate(m.net.down_kbps)}  ↑ ${rate(m.net.up_kbps)}`} />
          <div className="kv">
            <span>
              PC chalu: <b>{uptimeWords(m.uptime_s)}</b>
            </span>
            <span>
              <b>{m.cpu_cores}</b> cores
            </span>
          </div>
        </>
      )}
    </div>
  )
}
