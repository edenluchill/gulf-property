/**
 * Luna Tour — React overlay layer (§4.1 overlay table, the DOM-rendered subset).
 *
 * Map-anchored overlays (distance_line / amenity_spokes / highlight_all_pins)
 * are drawn by the map ref inside TimelineEngine; this layer renders the
 * graphic/animated ones: title, progress_dots, property_card, roi_card,
 * favorite_picker, cta.
 */
import { useEffect, useRef, useState } from 'react'
import type { RenderOverlay } from '../engine/TimelineEngine'
import type {
  Overlay,
  PropertySnapshot,
  TourAgent,
  TourUnit,
} from '../types'
import GrowthChart from './GrowthChart'

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
      const metro = p.distances?.find((d) => d.label.includes('地铁'))
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
                <span className="lt-card-price-unit"> 起</span>
              </div>
            )}
            <div className="lt-card-stats">
              {p.amenity_score != null && (
                <div className="lt-card-stat">
                  <b style={{ color: accent }}>{p.amenity_score}</b>
                  <span>便利度{p.amenity_tier ? ` · ${p.amenity_tier}` : ''}</span>
                </div>
              )}
              {metro && (
                <div className="lt-card-stat">
                  <b style={{ color: accent }}>{metro.distance_km}km</b>
                  <span>🚇 最近地铁</span>
                </div>
              )}
              {p.status && (
                <div className="lt-card-stat lt-card-stat-status">
                  <b>{p.status}</b>
                  <span>状态</span>
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
          <div className="lt-picker-title">最喜欢哪个?点个心 ❤️</div>
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
          <span className="lt-cta-text">{overlay.text ?? `和 ${agent.name} 聊聊`}</span>
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
  // 剧本挑中的那个户型排第一并高亮 —— 「这个才是给你的」。
  const focused = focus != null ? units.find((u) => u.bedrooms === focus) : undefined
  const hero = focused ?? units[0]
  const rest = units.filter((u) => u !== hero)

  return (
    <div className="lt-ov lt-ov-units">
      <div className="lt-units-head">可选户型</div>
      <div className="lt-unit-hero">
        {hero.floor_plan_image && (
          <img className="lt-unit-plan" src={hero.floor_plan_image} alt={hero.label} loading="eager" />
        )}
        <div className="lt-unit-hero-body">
          <div className="lt-unit-label" style={{ color: accent }}>
            {hero.label}
            {focused && <span className="lt-unit-fit">最适合你</span>}
          </div>
          <div className="lt-unit-figs">
            {hero.area_sqft != null && (
              <span>
                <b>{hero.area_sqft.toLocaleString()}</b> 尺起
              </span>
            )}
            {hero.price_from != null && (
              <span>
                <b>{formatAed(hero.price_from)}</b> 起
              </span>
            )}
          </div>
        </div>
      </div>
      {rest.length > 0 && (
        <div className="lt-unit-chips">
          {rest.map((u) => (
            <div key={u.bedrooms} className="lt-unit-chip">
              <b>{u.label}</b>
              {u.price_from != null && <span>{formatAed(u.price_from)} 起</span>}
            </div>
          ))}
        </div>
      )}
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
  const future = useCountUp(data.future, 1600)
  return (
    <div className="lt-ov lt-ov-roi">
      <div className="lt-roi-head">
        <span>{data.years} 年投资展望</span>
        <span className="lt-roi-growth" style={{ color: accent }}>
          +{data.growth_pct}%
        </span>
      </div>
      <div className="lt-roi-chart">
        <GrowthChart buy={data.buy} future={data.future} years={data.years} accent={accent} />
      </div>
      <div className="lt-roi-axis">
        <span>今年</span>
        <span>{data.years} 年后</span>
      </div>
      <div className="lt-roi-figures">
        <div>
          <label>买入</label>
          <b>{formatAed(data.buy)}</b>
        </div>
        <div className="lt-roi-right">
          <label>{data.years} 年后预测</label>
          <b style={{ color: accent }}>{formatAed(future)}</b>
        </div>
      </div>
      {data.yield_pct != null && (
        <div className="lt-roi-yield">参考租金回报率 ~{data.yield_pct}%（非保证，仅供参考）</div>
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
