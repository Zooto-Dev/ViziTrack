import { memo } from 'react'
import { useStore } from '../store'

/** Radial gauge made of 32 segments; lit segments show the value. */
const SegGauge = memo(function SegGauge({ label, pct, sub, warn }: { label: string; pct: number; sub: string; warn?: number }) {
  const v = Math.max(0, Math.min(100, pct))
  const n = 32
  const lit = Math.round((v / 100) * n)
  const hot = warn !== undefined && v >= warn
  const segs = []
  for (let i = 0; i < n; i++) {
    // 270° sweep starting bottom-left.
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

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : `${h}h ${m}m`
}

function fmtRate(kbps: number) {
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${Math.round(kbps)} KB/s`
}

export function SystemMonitor() {
  const m = useStore((s) => s.monitor)
  const hist = useStore((s) => s.history)
  return (
    <div className="panel">
      <div className="panel-title">
        <span>SYSTEM TELEMETRY</span>
        <span className="tag">SYS // 01</span>
      </div>
      {!m ? (
        <div className="dim">Waiting for telemetry…</div>
      ) : (
        <>
          <div className="sgauges">
            <SegGauge label="CPU" pct={m.cpu} sub={`${m.cpu_cores} cores`} warn={85} />
            <SegGauge label="MEMORY" pct={m.ram.pct} sub={`${m.ram.used_gb}/${m.ram.total_gb} GB`} warn={90} />
            <SegGauge label="DISK" pct={m.disk_pct ?? 0} sub={m.battery ? `BAT ${Math.round(m.battery.percent)}%` : 'C:'} warn={92} />
          </div>
          <Spark data={hist.cpu} max={100} label="CPU LOAD · 60s" value={`${Math.round(m.cpu)}%`} />
          <Spark data={hist.net} label="NETWORK · 60s" value={`↓${fmtRate(m.net.down_kbps)} ↑${fmtRate(m.net.up_kbps)}`} />
          <div className="kv mono">
            <span>
              OS <b>{m.os}</b>
            </span>
            <span>
              UP <b>{fmtUptime(m.uptime_s)}</b>
            </span>
          </div>
        </>
      )}
    </div>
  )
}
