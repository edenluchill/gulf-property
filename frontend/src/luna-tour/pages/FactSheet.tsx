/**
 * Luna Tour — verifiable FACT SHEET (E5).
 *
 * A printable, source-cited summary of a shared tour's properties: price,
 * 5-yr investment outlook, REAL nearby amenities (named), and live DLD market
 * evidence (last-30d sales volume, median AED/sqft, comparables) — each with a
 * "verify" link. The serious buyer can check every figure themselves; the agent
 * can hand it over as proof. Reuses the public endpoints (no new backend).
 *
 * Route: /factsheet/:code. ISOLATION: delete the file + route to remove.
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_BASE_URL } from '../../lib/config'
import type { WatchPayload, MarketEvidence, PropertySnapshot } from '../types'

function fmtAed(n?: number): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `AED ${(n / 1000).toFixed(0)}K`
  return `AED ${n}`
}

export default function FactSheet() {
  const { code } = useParams<{ code: string }>()
  const [data, setData] = useState<WatchPayload | null>(null)
  const [evidence, setEvidence] = useState<Record<string, MarketEvidence>>({})
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!code) return
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE_URL}/api/luna/public/v/${encodeURIComponent(code)}`)
        if (!r.ok) {
          if (alive) setErr('未找到该导览')
          return
        }
        const d = (await r.json()) as WatchPayload
        if (!alive) return
        setData(d)
        // fetch evidence per property
        d.properties.forEach(async (p) => {
          const s = p.snapshot
          const qs = new URLSearchParams()
          if (s.name) qs.set('project', s.name)
          if (s.area) qs.set('area', s.area)
          try {
            const er = await fetch(`${API_BASE_URL}/api/luna/public/evidence?${qs.toString()}`)
            if (er.ok) {
              const ej = (await er.json()) as { evidence: MarketEvidence | null }
              if (alive && ej.evidence) setEvidence((cur) => ({ ...cur, [p.project_id ?? p.id]: ej.evidence! }))
            }
          } catch {
            /* evidence optional */
          }
        })
      } catch {
        if (alive) setErr('网络错误')
      }
    })()
    return () => {
      alive = false
    }
  }, [code])

  if (err) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>{err}</div>
  if (!data) return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>正在生成事实清单…</div>

  return (
    <div className="fs-root">
      <style>{`
        .fs-root { max-width: 820px; margin: 0 auto; padding: 32px 28px 60px; color: #111827;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
        .fs-print { position: sticky; top: 12px; float: right; background: #0d9488; color: #fff; border: none;
          border-radius: 8px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
        .fs-h1 { font-size: 24px; font-weight: 800; margin: 0 0 4px; }
        .fs-sub { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
        .fs-card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px 20px; margin-bottom: 18px; break-inside: avoid; }
        .fs-name { font-size: 18px; font-weight: 700; }
        .fs-meta { color: #6b7280; font-size: 13px; margin-bottom: 10px; }
        .fs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; font-size: 14px; }
        .fs-sec { font-size: 12px; font-weight: 700; color: #0d9488; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.04em; }
        .fs-row { font-size: 13px; padding: 2px 0; display: flex; justify-content: space-between; gap: 12px; }
        .fs-src { font-size: 11px; color: #6b7280; margin-top: 6px; }
        .fs-src a { color: #0d9488; }
        .fs-disc { font-size: 10.5px; color: #9ca3af; margin-top: 8px; }
        .fs-foot { font-size: 11px; color: #9ca3af; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
        @media print { .fs-print { display: none; } .fs-root { padding: 0; } }
      `}</style>
      <button className="fs-print" onClick={() => window.print()}>🖨 打印 / 存 PDF</button>
      <div className="fs-h1">{data.session.title}</div>
      <div className="fs-sub">
        {data.agent.name} · Luna 事实清单 — 所有数据可核验
        {data.session.data_as_of ? ` · 数据截至 ${data.session.data_as_of}` : ''}
      </div>

      {data.properties.map((p) => {
        const s: PropertySnapshot = p.snapshot
        const ev = evidence[p.project_id ?? p.id]
        return (
          <div className="fs-card" key={p.id}>
            <div className="fs-name">{s.name}</div>
            <div className="fs-meta">
              {[s.area, s.developer, s.status].filter(Boolean).join(' · ')}
            </div>
            <div className="fs-grid">
              <div>价格(起): <b>{fmtAed(s.min_price)}</b></div>
              {s.amenity_score != null && <div>便利度评分: <b>{s.amenity_score}/100{s.amenity_tier ? ` (${s.amenity_tier})` : ''}</b></div>}
            </div>

            {s.investment && (
              <>
                <div className="fs-sec">投资展望（{s.investment.years} 年）</div>
                <div className="fs-grid">
                  <div>买入: <b>{fmtAed(s.investment.buy)}</b></div>
                  <div>预测价值: <b>{fmtAed(s.investment.future)}</b></div>
                  <div>增长: <b>+{s.investment.growth_pct}%</b></div>
                  {s.investment.yield_pct != null && <div>参考租金回报: <b>~{s.investment.yield_pct}%</b></div>}
                </div>
                <div className="fs-disc">投资数字为基于参考假设的估算,非保证回报。</div>
              </>
            )}

            {s.distances && s.distances.length > 0 && (
              <>
                <div className="fs-sec">周边真实配套(地图实测距离)</div>
                {s.distances.map((d, i) => (
                  <div className="fs-row" key={i}>
                    <span>{d.label}</span>
                    <b>{d.distance_km} km</b>
                  </div>
                ))}
              </>
            )}

            {ev && (
              <>
                <div className="fs-sec">真实成交证据（{ev.granularity === 'project' ? '本楼盘' : '本区域'} · {ev.scope}）</div>
                <div className="fs-grid">
                  <div>近 {ev.window_days} 天成交: <b>{ev.volume} 套</b></div>
                  {ev.median_psf != null && <div>中位价: <b>{ev.median_psf.toLocaleString()} AED/sqft</b></div>}
                </div>
                {ev.comparables.length > 0 && (
                  <>
                    <div className="fs-row" style={{ color: '#6b7280', marginTop: 6 }}><span>最近可比成交</span><span></span></div>
                    {ev.comparables.map((c, i) => (
                      <div className="fs-row" key={i}>
                        <span>{c.date} · {c.rooms || '—'}{c.is_offplan ? ' · 期房' : ''}</span>
                        <b>{fmtAed(c.worth)} · {c.psf.toLocaleString()}/sqft</b>
                      </div>
                    ))}
                  </>
                )}
                <div className="fs-src">
                  来源:{ev.source.label}（截至 {ev.source.as_of}） · <a href={ev.source.url} target="_blank" rel="noreferrer">核验 →</a>
                </div>
                <div className="fs-disc">{ev.disclaimer}</div>
              </>
            )}
          </div>
        )
      })}

      <div className="fs-foot">
        由 Luna 生成 · 配套距离来自地图实测 · 成交数据来自迪拜土地局(DLD)公开记录 · 联系经纪 {data.agent.name}
        {data.agent.phone ? ` · ${data.agent.phone}` : ''}
      </div>
    </div>
  )
}
