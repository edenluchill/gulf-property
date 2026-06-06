/**
 * Luna Tour — market EVIDENCE card (E1 credibility layer).
 *
 * Shows REAL Dubai Land Department data next to the investment claim: last-30d
 * sales volume, median AED/sqft, a couple of recent comparable sales — each with
 * a "verify →" link to DLD so the customer can check it themselves. A chart
 * nobody believes becomes a sourced, checkable fact.
 *
 * ISOLATION: pure presentational; rendered by TourOverlay when the investment
 * (roi_card) beat is active. Delete with the luna-tour directory.
 */
import type { MarketEvidence } from '../types'

function fmtAed(n: number): string {
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `AED ${(n / 1000).toFixed(0)}K`
  return `AED ${n}`
}

export default function EvidenceCard({ evidence, accent }: { evidence: MarketEvidence; accent: string }) {
  const ev = evidence
  const scopeLabel = ev.granularity === 'project' ? '本楼盘' : '本区域'
  return (
    <div className="lt-evidence" style={{ ['--lt-accent' as string]: accent }}>
      <div className="lt-ev-head">
        <span className="lt-ev-live">● 真实成交</span>
        <a className="lt-ev-verify" href={ev.source.url} target="_blank" rel="noopener noreferrer">
          核验 →
        </a>
      </div>
      <div className="lt-ev-scope">
        {scopeLabel} · {ev.scope}
      </div>
      <div className="lt-ev-stats">
        <div className="lt-ev-stat">
          <b>{ev.volume}</b>
          <span>近 {ev.window_days} 天成交</span>
        </div>
        {ev.median_psf != null && (
          <div className="lt-ev-stat">
            <b>{ev.median_psf.toLocaleString()}</b>
            <span>中位 AED/sqft</span>
          </div>
        )}
      </div>
      {ev.comparables.length > 0 && (
        <div className="lt-ev-comps">
          {ev.comparables.slice(0, 3).map((c, i) => (
            <div className="lt-ev-comp" key={i}>
              <span className="lt-ev-comp-main">
                {c.rooms || '—'} · {c.psf.toLocaleString()}/sqft
              </span>
              <span className="lt-ev-comp-sub">
                {fmtAed(c.worth)} · {c.date}
                {c.is_offplan ? ' · 期房' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="lt-ev-src">
        {ev.source.label} · 截至 {ev.source.as_of}
      </div>
    </div>
  )
}
