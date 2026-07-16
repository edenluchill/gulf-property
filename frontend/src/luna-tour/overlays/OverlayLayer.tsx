/**
 * Luna Tour — React overlay layer (§4.1 overlay table, the DOM-rendered subset).
 *
 * Map-anchored overlays (distance_line / amenity_spokes / highlight_all_pins)
 * are drawn by the map ref inside TimelineEngine; this layer renders the
 * graphic/animated ones: title, progress_dots, property_card, roi_card,
 * favorite_picker, cta.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RenderOverlay } from '../engine/TimelineEngine'
import type {
  AreaStats,
  Overlay,
  PropertySnapshot,
  TourAgent,
  TourUnit,
} from '../types'
import GrowthChart from './GrowthChart'

type T = (k: string, o?: Record<string, unknown>) => string

/**
 * 户型名从 `bedrooms` 现算,不用 `unit.label`。
 * label 是后端拼的展示文案,那里只有 en/zh 两个分支 —— ar/ru/fr 会穿透成中文。
 * bedrooms 是结构化真值,前端翻能跟着 tour 语言走。
 */
function unitLabel(t: T, bedrooms: number): string {
  return bedrooms === 0
    ? t('tourOverlay.studio')
    : t('tourOverlay.nBed', { n: bedrooms })
}

interface OverlayLayerProps {
  overlays: RenderOverlay[]
  properties: Map<string, PropertySnapshot>
  /** map session property id → snapshot key used in script (same id) */
  agent: TourAgent
  accent: string
  favorites: Set<string>
  onFavorite: (propertyId: string) => void
  onCta: () => void
}

export default function OverlayLayer({
  overlays,
  properties,
  agent,
  accent,
  favorites,
  onFavorite,
  onCta,
}: OverlayLayerProps) {
  return (
    <div className="lt-overlay-root" style={{ ['--lt-accent' as string]: accent }}>
      {overlays.map((o) => (
        <OverlayItem
          key={o.key}
          overlay={o.overlay}
          properties={properties}
          agent={agent}
          accent={accent}
          favorites={favorites}
          onFavorite={onFavorite}
          onCta={onCta}
        />
      ))}
    </div>
  )
}

function OverlayItem({
  overlay,
  properties,
  agent,
  accent,
  favorites,
  onFavorite,
  onCta,
}: {
  overlay: Overlay
  properties: Map<string, PropertySnapshot>
  agent: TourAgent
  accent: string
  favorites: Set<string>
  onFavorite: (id: string) => void
  onCta: () => void
}) {
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as T

  switch (overlay.type) {
    case 'title':
      return (
        <div className="lt-ov lt-ov-title">
          <h1>{overlay.text}</h1>
          {overlay.subtitle && <p>{overlay.subtitle}</p>}
        </div>
      )

    case 'progress_dots':
      // Superseded by the top chapter bar (lt-chapters) — render nothing so we
      // don't show a second, redundant progress indicator.
      return null

    /**
     * 项目卡。
     *
     * ⚠️ 手机上这张卡曾经**贴顶全宽、占掉 39% 的屏幕**，而且正好盖住项目本身
     *    （pin 就在卡片正下方）—— 客户来看房，房子被卡片挡了。还和顶部的经纪头像
     *    重叠，项目名只露出半截。
     *
     * 现在：`.lt-card-body` 这层 wrapper 让手机能把它排成**底部横向小卡**
     *（缩略图 + 名字 + 价格，占屏 ~13%），地图主体全程可见。桌面保持左侧竖卡。
     */
    case 'property_card': {
      const p = properties.get(overlay.property_id)
      if (!p) return null
      // 认品类走结构化的 cat,不看 label —— label 是展示文案,一换 tour 语言
      // 「地铁」就没了,这一行会**静默消失**(客户端不报错,只是少了个信息)。
      // ‖ 兜底:DB 里的历史 session 是在 cat 之前生成的,没有该字段 → 回退到旧的
      //   中文子串匹配。等历史 session 过期后可以删掉后半截。
      const metro = p.distances?.find((d) =>
        d.cat ? d.cat === 'metro_station' : d.label.includes('地铁')
      )
      return (
        <div className="lt-ov lt-ov-card">
          {p.image && (
            <div className="lt-card-img">
              <img src={p.image} alt={p.name} loading="eager" />
            </div>
          )}
          <div className="lt-card-body">
            {p.area && <div className="lt-card-area">📍 {p.area}</div>}
            <div className="lt-card-name">{p.name}</div>
            {p.developer && <div className="lt-card-dev">{p.developer}</div>}
            {p.min_price != null && (
              <div className="lt-card-price">
                {formatAed(p.min_price)}
                <span className="lt-card-price-unit"> {t('tourOverlay.fromSuffix')}</span>
              </div>
            )}
            <div className="lt-card-stats">
              {p.amenity_score != null && (
                <div className="lt-card-stat">
                  <b style={{ color: accent }}>{p.amenity_score}</b>
                  <span>
                    {t('tourOverlay.amenityScore')}
                    {p.amenity_tier ? ` · ${p.amenity_tier}` : ''}
                  </span>
                </div>
              )}
              {metro && (
                <div className="lt-card-stat">
                  <b style={{ color: accent }}>{metro.distance_km}km</b>
                  <span>🚇 {t('tourOverlay.nearestMetro')}</span>
                </div>
              )}
              {p.status && (
                <div className="lt-card-stat lt-card-stat-status">
                  <b>{p.status}</b>
                  <span>{t('tourOverlay.status')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )
    }

    case 'roi_card':
      return <RoiCard data={overlay.data} accent={accent} />

    /**
     * 🔴 地理套利 —— **地图能做、而 PDF 楼书永远做不到的那件事。**
     *
     * 投资客真正想知道的不是「这个项目涨多少」,而是
     * **「我为什么该买这里,而不是走路 5 分钟外的那个区」**。
     *
     * 数字全部来自 snapshot.area_context(真实 DLD),overlay 只带 property_id ——
     * 只要给模型一个能填数字的字段,它就会编。
     */
    case 'area_compare': {
      const p = properties.get(overlay.property_id)
      const ctx = p?.area_context
      if (!ctx?.neighbors?.length) return null
      return <AreaCompareCard ctx={ctx} accent={accent} />
    }

    /**
     * 户型卡 —— 整场 tour 里客户唯一一次知道「我能买到什么」。
     *
     * 数字全部来自 PropertySnapshot.units（真实 project_unit_types），overlay 只带
     * property_id + focus_bedrooms。剧本编不了户型。
     */
    case 'unit_card': {
      const p = properties.get(overlay.property_id)
      if (!p?.units?.length) return null
      return <UnitCard units={p.units} focus={overlay.focus_bedrooms} accent={accent} />
    }

    case 'favorite_picker': {
      const cards = overlay.property_ids
        .map((id) => ({ id, p: properties.get(id) }))
        .filter((x) => x.p) as { id: string; p: PropertySnapshot }[]
      return (
        <div className="lt-ov lt-ov-picker">
          <div className="lt-picker-title">{t('tourOverlay.pickFavorite')}</div>
          <div className="lt-picker-row">
            {cards.map(({ id, p }) => (
              <button
                key={id}
                className={`lt-pick ${favorites.has(id) ? 'liked' : ''}`}
                onClick={() => onFavorite(id)}
              >
                <span className="lt-pick-name">{p.name}</span>
                <span className="lt-pick-area">{p.area}</span>
                <span className="lt-pick-heart">{favorites.has(id) ? '❤️' : '🤍'}</span>
              </button>
            ))}
          </div>
        </div>
      )
    }

    case 'cta':
      return (
        <button className="lt-ov lt-ov-cta" onClick={onCta}>
          {agent.photo_url && <img src={agent.photo_url} alt={agent.name} />}
          <span className="lt-cta-text">
            {overlay.text ?? t('tourOverlay.chatWith', { name: agent.name })}
          </span>
          <span className="lt-cta-arrow">→</span>
        </button>
      )

    case 'media': {
      // Real footage (sea view / interior) the agent attached — proof a chart
      // can't give. Muted (narration is the audio), looping, framed inset.
      const fit = overlay.fit === 'contain' ? 'contain' : 'cover'
      return (
        <div className="lt-ov lt-ov-media">
          {overlay.media_kind === 'video' ? (
            <video
              src={overlay.url}
              autoPlay
              muted
              loop
              playsInline
              style={{ objectFit: fit }}
            />
          ) : (
            <img src={overlay.url} alt={overlay.caption || ''} style={{ objectFit: fit }} loading="eager" />
          )}
          {overlay.caption && <div className="lt-media-cap">{overlay.caption}</div>}
        </div>
      )
    }

    default:
      return null
  }
}

function UnitCard({
  units,
  focus,
  accent,
}: {
  units: TourUnit[]
  focus?: number
  accent: string
}) {
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as T

  // 剧本挑中的那个户型排第一并高亮 —— 「这个才是给你的」。
  const focused = focus != null ? units.find((u) => u.bedrooms === focus) : undefined
  const hero = focused ?? units[0]
  const rest = units.filter((u) => u !== hero)
  const heroLabel = unitLabel(t, hero.bedrooms)

  return (
    <div className="lt-ov lt-ov-units">
      <div className="lt-units-head">{t('tourOverlay.units')}</div>
      <div className="lt-unit-hero">
        {hero.floor_plan_image && (
          <img className="lt-unit-plan" src={hero.floor_plan_image} alt={heroLabel} loading="eager" />
        )}
        <div className="lt-unit-hero-body">
          <div className="lt-unit-label" style={{ color: accent }}>
            {heroLabel}
            {focused && <span className="lt-unit-fit">{t('tourOverlay.bestFit')}</span>}
          </div>
          <div className="lt-unit-figs">
            {hero.area_sqft != null && (
              <span>
                <b>{hero.area_sqft.toLocaleString()}</b> {t('tourOverlay.sqftFrom')}
              </span>
            )}
            {hero.price_from != null && (
              <span>
                <b>{formatAed(hero.price_from)}</b> {t('tourOverlay.fromSuffix')}
              </span>
            )}
          </div>
        </div>
      </div>
      {rest.length > 0 && (
        <div className="lt-unit-chips">
          {rest.map((u) => (
            <div key={u.bedrooms} className="lt-unit-chip">
              <b>{unitLabel(t, u.bedrooms)}</b>
              {u.price_from != null && (
                <span>
                  {formatAed(u.price_from)} {t('tourOverlay.fromSuffix')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AreaCompareCard({
  ctx,
  accent,
}: {
  ctx: NonNullable<PropertySnapshot['area_context']>
  accent: string
}) {
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as T

  const rows: (AreaStats & { self?: boolean })[] = [
    { ...ctx.self, self: true },
    ...ctx.neighbors.slice(0, 3),
  ]

  return (
    <div className="lt-ov lt-ov-compare">
      <div className="lt-cmp-head">{t('tourOverlay.compareHead')}</div>
      <div className="lt-cmp-sub">{t('tourOverlay.compareSub')}</div>
      <div className="lt-cmp-grid">
        <div className="lt-cmp-row lt-cmp-hdr">
          <span />
          <span>{t('tourOverlay.colGrowth')}</span>
          <span>{t('tourOverlay.colYield')}</span>
          <span>{t('tourOverlay.colPriceSqm')}</span>
          <span>{t('tourOverlay.colTxPerYear')}</span>
        </div>
        {rows.map((r) => (
          <div key={r.name} className={`lt-cmp-row ${r.self ? 'is-self' : ''}`}>
            <span className="lt-cmp-name">
              {r.self ? '📍 ' : ''}
              {r.name}
              {!r.self && <i className="lt-cmp-km">{r.distance_km}km</i>}
            </span>
            <span style={r.self ? { color: accent, fontWeight: 800 } : undefined}>
              {r.growth_pct}%
            </span>
            <span style={r.self ? { color: accent, fontWeight: 800 } : undefined}>
              {r.yield_pct}%
            </span>
            <span className="lt-cmp-price">
              {r.price_sqm ? r.price_sqm.toLocaleString() : '—'}
              {!r.self && r.price_sqm > 0 && (
                <i className={r.price_sqm > ctx.self.price_sqm ? 'up' : 'down'}>
                  {r.price_sqm > ctx.self.price_sqm ? '+' : ''}
                  {Math.round(((r.price_sqm - ctx.self.price_sqm) / ctx.self.price_sqm) * 100)}%
                </i>
              )}
            </span>
            <span className="lt-cmp-tx">
              {/* 成交量 = 流动性 = 你想卖的时候有没有人接盘。条越长越好出手。 */}
              <b>{(r.transactions / 1000).toFixed(1)}k</b>
              <i style={{ width: `${Math.max(4, (r.transactions / Math.max(...rows.map((x) => x.transactions), 1)) * 100)}%`, background: r.self ? accent : 'rgba(255,255,255,0.25)' }} />
            </span>
          </div>
        ))}
      </div>
      <div className="lt-cmp-foot">
        {t('tourOverlay.compareFoot')}
        <span className="lt-cmp-note">{t('tourOverlay.compareNote')}</span>
      </div>
    </div>
  )
}

function RoiCard({
  data,
  accent,
}: {
  data: { buy: number; future: number; years: number; growth_pct: number; yield_pct?: number }
  accent: string
}) {
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as T
  const future = useCountUp(data.future, 1600)
  return (
    <div className="lt-ov lt-ov-roi">
      <div className="lt-roi-head">
        <span>{t('tourOverlay.roiHead', { years: data.years })}</span>
        <span className="lt-roi-growth" style={{ color: accent }}>
          +{data.growth_pct}%
        </span>
      </div>
      <div className="lt-roi-chart">
        <GrowthChart buy={data.buy} future={data.future} years={data.years} accent={accent} />
      </div>
      <div className="lt-roi-axis">
        <span>{t('tourOverlay.roiThisYear')}</span>
        <span>{t('tourOverlay.roiInYears', { years: data.years })}</span>
      </div>
      <div className="lt-roi-figures">
        <div>
          <label>{t('tourOverlay.roiBuy')}</label>
          <b>{formatAed(data.buy)}</b>
        </div>
        <div className="lt-roi-right">
          <label>{t('tourOverlay.roiForecast', { years: data.years })}</label>
          <b style={{ color: accent }}>{formatAed(future)}</b>
        </div>
      </div>
      {data.yield_pct != null && (
        <div className="lt-roi-yield">{t('tourOverlay.roiYield', { pct: data.yield_pct })}</div>
      )}
    </div>
  )
}

function useCountUp(target: number, durationMs: number): number {
  const [val, setVal] = useState(0)
  const startRef = useRef<number | null>(null)
  useEffect(() => {
    let raf = 0
    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now
      const p = Math.min(1, (now - startRef.current) / durationMs)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])
  return val
}

function formatAed(n: number): string {
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `AED ${(n / 1000).toFixed(0)}K`
  return `AED ${n}`
}
