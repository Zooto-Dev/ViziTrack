import { memo } from 'react'
import { useStore } from '../store'

const Gauge = memo(function Gauge({ label, pct, sub, warn }: { label: string; pct: number; sub: string; warn?: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, pct))
  const hot = warn !== undefined && v >= warn
  return (
    <div className={`gauge ${hot ? 'hot' : ''}`}>
      <svg viewBox="0 0 64 64" className="gauge-svg" aria-hidden>
        <circle cx="32" cy="32" r={r} className="gauge-track" />
        <circle
          cx="32"
          cy="32"
          r={r}
          className="gauge-value"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
        />
        <text x="32" y="36" textAnchor="middle" className="gauge-num">
          {Math.round(v)}
        </text>
      </svg>
      <div className="gauge-label">{label}</div>
      <div className="gauge-sub mono">{sub}</div>
    </div>
  )
})

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
  if (!m) {
    return (
      <div className="panel">
        <div className="panel-title">
          <span>SYSTEM</span>
        </div>
        <div className="dim">Waiting for telemetry…</div>
      </div>
    )
  }
  const netPct = Math.min(100, ((m.net.up_kbps + m.net.down_kbps) / 2048) * 100) // 2 MB/s = full
  return (
    <div className="panel">
      <div className="panel-title">
        <span>SYSTEM</span>
        <span className="mono dim">{m.os}</span>
      </div>
      <div className="gauges">
        <Gauge label="CPU" pct={m.cpu} sub={`${m.cpu_cores} cores`} warn={85} />
        <Gauge label="RAM" pct={m.ram.pct} sub={`${m.ram.used_gb} / ${m.ram.total_gb} GB`} warn={90} />
        <Gauge label="NET" pct={netPct} sub={`↓${fmtRate(m.net.down_kbps)} ↑${fmtRate(m.net.up_kbps)}`} />
      </div>
      <div className="kv mono">
        {m.disk_pct !== null && (
          <span>
            DISK <b>{Math.round(m.disk_pct)}%</b>
          </span>
        )}
        {m.battery && (
          <span>
            BAT <b>{Math.round(m.battery.percent)}%</b>
            {m.battery.plugged ? ' ⚡' : ''}
          </span>
        )}
        <span>
          UP <b>{fmtUptime(m.uptime_s)}</b>
        </span>
      </div>
    </div>
  )
}
