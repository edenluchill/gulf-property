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
              <div className="lt-card-stat">
                <b>{p.status}</b>
                <span>状态</span>
              </div>
            )}
          </div>
        </div>
      )
    }

    case 'roi_card':
      return <RoiCard data={overlay.data} accent={accent} />

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

    default:
      return null
  }
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
