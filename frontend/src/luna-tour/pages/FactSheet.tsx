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
import i18n from '../../i18n'
import { API_BASE_URL } from '../../lib/config'
import { distanceLabel, tierLabel } from '../amenityLabel'
import type { WatchPayload, MarketEvidence, PropertySnapshot } from '../types'

type TFn = (k: string, o?: Record<string, unknown>) => string

/**
 * 事实清单是**经纪递给客户的文档**,不是经纪自己的工作台:正文(旁白/配套 label/
 * 免责声明)是生成 tour 那一刻按 `payload.language` 写好并存库的。所以标签必须锁同一
 * 语言(getFixedT 非响应式)—— 跟浏览者 UI 语言走的话,中文导览的清单被英文浏览器打开
 * 会变成「英文标签 + 中文数据行」。同 ClientReportPage 的范式。
 */
const docNs = (lang: string): TFn =>
  (i18n.getFixedT as (l: string, ns: string) => TFn)(!lang || lang === 'zh' ? 'zh-CN' : lang, 'factSheet')

function fmtAed(n?: number): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `AED ${(n / 1000).toFixed(0)}K`
  return `AED ${n}`
}

/** 户型名从 bedrooms 现算 —— 后端的 `unit.label` 已废弃(见 types.TourUnit)。 */
const unitLabel = (t: TFn, bedrooms: number): string =>
  bedrooms === 0 ? t('units.studio') : t('units.nBed', { n: bedrooms })

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
          if (alive) setErr('notFound')
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
        if (alive) setErr('networkError')
      }
    })()
    return () => {
      alive = false
    }
  }, [code])

  // 加载/错误态还没有 payload → 没有文档语言可锁,只能跟浏览者 UI 语言。
  if (err) {
    const tUi = docNs(i18n.language || 'en')
    return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>{tUi(err)}</div>
  }
  if (!data) {
    const tUi = docNs(i18n.language || 'en')
    return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>{tUi('generating')}</div>
  }

  const lang = data.language || 'zh'
  const t = docNs(lang)

  return (
    // <html dir> 跟的是 UI 语言 → 英文 UI 打开阿语清单会「正文阿语、版面 LTR」。
    // 文档自己的方向必须由文档语言决定。
    <div className="fs-scroll" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <div className="fs-root">
      <style>{`
        /* 🔴 **必须自己滚。**
           app 根是 h-screen + overflow-hidden —— **window 从来不滚动**(项目老坑)。
           靠 window 滚的页面在这里全是死的:owner 实测「没办法 scroll down」。 */
        .fs-scroll { position: fixed; inset: 0; overflow-y: auto; background: #fff; -webkit-overflow-scrolling: touch; }
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
        /* 照片 + 涨幅图 —— 之前一张图都没有,清单看起来像一堆干巴巴的数字 */
        .fs-photo { width: 100%; height: 190px; object-fit: cover; border-radius: 10px; margin-bottom: 12px; background: #f3f4f6; }
        .fs-chart { margin-top: 8px; }
        .fs-chart-axis { display: flex; justify-content: space-between; font-size: 10.5px; color: #9ca3af; margin-top: 2px; }
        @media print {
          .fs-print { display: none; }
          .fs-scroll { position: static; overflow: visible; }
          .fs-root { padding: 0; }
          .fs-card { break-inside: avoid; }
        }
      `}</style>
      <button className="fs-print" onClick={() => window.print()}>🖨 {t('print')}</button>
      <div className="fs-h1">{data.session.title}</div>
      <div className="fs-sub">
        {data.agent.name} · {t('byline')}
        {data.session.data_as_of ? ` · ${t('dataAsOf', { date: data.session.data_as_of })}` : ''}
      </div>

      {data.properties.map((p) => {
        const s: PropertySnapshot = p.snapshot
        const ev = evidence[p.project_id ?? p.id]
        return (
          <div className="fs-card" key={p.id}>
            {s.image && <img className="fs-photo" src={s.image} alt={s.name} loading="lazy" />}
            <div className="fs-name">{s.name}</div>
            <div className="fs-meta">
              {[s.area, s.developer, s.status].filter(Boolean).join(' · ')}
            </div>
            <div className="fs-grid">
              <div>{t('priceFrom')}: <b>{fmtAed(s.min_price)}</b></div>
              {s.amenity_score != null && <div>{t('amenityScore')}: <b>{s.amenity_score}/100{tierLabel(t, s.amenity_tier) ? ` (${tierLabel(t, s.amenity_tier)})` : ''}</b></div>}
            </div>

            {/**
              * 🔴 **没数据的时候要说话。**
              *
              * owner:「事实清单也不错,不过现在感觉不 complete?」——
              * 截图里 Palm Central 2 **只有一个价格**。不是漏了,是那个区(Palm Jebel Ali)
              * 真的**没有足够的成交数据**(204 笔,过不了门槛),半径内也查不到配套 POI。
              *
              * 但**空着不解释,看起来就像产品坏了**。诚实地说「这个区暂无足够成交数据」,
              * 比留一片空白强 —— 而且它本身就是一条信息(新区、流动性低)。
              */}
            {!s.investment && !s.distances?.length && !ev && (
              <div className="fs-disc" style={{ marginTop: 10 }}>
                {t('noData')}
              </div>
            )}

            {/* 户型 —— 客户真正要买的东西。数据一直都在，只是这张表没展示。 */}
            {s.units && s.units.length > 0 && (
              <>
                <div className="fs-sec">{t('units.title')}</div>
                {s.units.map((u) => (
                  <div className="fs-row" key={u.bedrooms}>
                    <span>{unitLabel(t, u.bedrooms)}{u.variants > 1 ? ` · ${t('units.variants', { n: u.variants })}` : ''}</span>
                    <b>
                      {u.area_sqft ? t('units.sqftFrom', { n: u.area_sqft.toLocaleString('en-US') }) : ''}
                      {u.area_sqft && u.price_from ? ' · ' : ''}
                      {u.price_from ? t('units.priceFrom', { price: fmtAed(u.price_from) }) : ''}
                    </b>
                  </div>
                ))}
              </>
            )}

            {/* 邻区对比 —— 「为什么是这里,而不是走路 5 分钟外的那个区」 */}
            {s.area_context && s.area_context.neighbors.length > 0 && (
              <>
                <div className="fs-sec">{t('neighbors.title')}</div>
                <div className="fs-row" style={{ color: '#6b7280' }}>
                  <span>{t('neighbors.area')}</span>
                  <span>{t('neighbors.cols')}</span>
                </div>
                {[{ ...s.area_context.self, self: true }, ...s.area_context.neighbors.slice(0, 3)].map((n) => (
                  <div className="fs-row" key={n.name}>
                    <span>{'self' in n && n.self ? '📍 ' : ''}{n.name}{'self' in n && n.self ? '' : ` (${n.distance_km}km)`}</span>
                    <b>
                      {n.growth_pct}% · {n.yield_pct}% · {n.price_sqm.toLocaleString()} · {n.transactions.toLocaleString()}
                    </b>
                  </div>
                ))}
                {s.area_context.weakness && (
                  <div className="fs-disc" style={{ marginTop: 6 }}>
                    {s.area_context.weakness.claim} {s.area_context.weakness.rebuttal}
                  </div>
                )}
                <div className="fs-src">{t('neighbors.source')}</div>
              </>
            )}

            {s.investment && (
              <>
                <div className="fs-sec">{t('invest.title', { years: s.investment.years })}</div>
                <div className="fs-grid">
                  <div>{t('invest.buy')}: <b>{fmtAed(s.investment.buy)}</b></div>
                  <div>{t('invest.future')}: <b>{fmtAed(s.investment.future)}</b></div>
                  <div>{t('invest.growth')}: <b>+{s.investment.growth_pct}%</b></div>
                  {s.investment.yield_pct != null && <div>{t('invest.yield')}: <b>~{s.investment.yield_pct}%</b></div>}
                </div>
                {/* 涨幅图 —— 一条线胜过四个数字 */}
                <div className="fs-chart">
                  <svg viewBox="0 0 320 70" width="100%" height="70" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id={`g-${p.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0d9488" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="#0d9488" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d="M0,62 C120,58 200,34 320,8 L320,70 L0,70 Z" fill={`url(#g-${p.id})`} />
                    <path d="M0,62 C120,58 200,34 320,8" fill="none" stroke="#0d9488" strokeWidth="2" />
                    <circle cx="320" cy="8" r="3.5" fill="#0d9488" />
                  </svg>
                  <div className="fs-chart-axis">
                    <span>{t('invest.thisYear')} · {fmtAed(s.investment.buy)}</span>
                    <span>{t('invest.inYears', { years: s.investment.years })} · {fmtAed(s.investment.future)}</span>
                  </div>
                </div>
                <div className="fs-disc">{t('invest.disclaimer')}</div>
              </>
            )}

            {s.distances && s.distances.length > 0 && (
              <>
                <div className="fs-sec">{t('nearby.title')}</div>
                {s.distances.map((d, i) => (
                  <div className="fs-row" key={i}>
                    <span>{distanceLabel(t, d)}</span>
                    <b>{d.distance_km} km</b>
                  </div>
                ))}
              </>
            )}

            {ev && (
              <>
                <div className="fs-sec">{t('evidence.title', { granularity: ev.granularity === 'project' ? t('evidence.thisProject') : t('evidence.thisArea'), scope: ev.scope })}</div>
                <div className="fs-grid">
                  <div>{t('evidence.window', { days: ev.window_days })}: <b>{t('evidence.deals', { n: ev.volume })}</b></div>
                  {ev.median_psf != null && <div>{t('evidence.medianPsf')}: <b>{ev.median_psf.toLocaleString('en-US')} AED/sqft</b></div>}
                </div>
                {ev.comparables.length > 0 && (
                  <>
                    <div className="fs-row" style={{ color: '#6b7280', marginTop: 6 }}><span>{t('evidence.comparables')}</span><span></span></div>
                    {ev.comparables.map((c, i) => (
                      <div className="fs-row" key={i}>
                        <span>{c.date} · {c.rooms || '—'}{c.is_offplan ? ` · ${t('evidence.offplan')}` : ''}</span>
                        <b>{fmtAed(c.worth)} · {c.psf.toLocaleString('en-US')}/sqft</b>
                      </div>
                    ))}
                  </>
                )}
                <div className="fs-src">
                  {t('evidence.source', { label: ev.source.label, asOf: ev.source.as_of })} · <a href={ev.source.url} target="_blank" rel="noreferrer">{t('evidence.verify')} →</a>
                </div>
                <div className="fs-disc">{ev.disclaimer}</div>
              </>
            )}
          </div>
        )
      })}

      <div className="fs-foot">
        {t('footer', { agent: data.agent.name })}
        {data.agent.phone ? ` · ${data.agent.phone}` : ''}
      </div>
    </div>
    </div>
  )
}
