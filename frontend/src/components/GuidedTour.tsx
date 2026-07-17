import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { Pause, Play, X, ChevronLeft, ChevronRight, TrendingUp, MapPin, Receipt } from 'lucide-react'
import { GuidedTourPayload, GuidedStop } from '../hooks/voice-assistant/types'
import { formatMoneyCompact, formatMoneyFull } from '../lib/money'
import { pricePerSqmToPerSqft } from '../lib/units'
import { getImageUrl } from '../lib/image-utils'
import DirhamSymbol from './DirhamSymbol'

// Dwell per stop. Generous so Luna's narration of a stop finishes before the panel
// auto-advances (customers reported step 1 jumping before its info was read/heard).
const DWELL_BY_KIND: Record<GuidedStop['kind'], number> = {
  advantages: 10000,
  environment: 12000,   // more to take in (spokes + list)
  transactions: 9000,
}

interface Props {
  tour: GuidedTourPayload
  onClose: () => void
  /** fly the camera to a point */
  onCamera: (loc: { lat: number; lng: number; zoom?: number }) => void
  /** draw amenity spokes (auto-frames), or clear with null */
  onAmenities: (a: { center: [number, number]; centerName: string; score: number; tier: string; spokes: GuidedStop['spokes'] } | null) => void
}

const STOP_META: Record<GuidedStop['kind'], { zh: string; en: string; Icon: typeof TrendingUp }> = {
  advantages: { zh: '优势', en: 'Advantages', Icon: TrendingUp },
  environment: { zh: '环境', en: 'Environment', Icon: MapPin },
  transactions: { zh: '成交', en: 'Sales', Icon: Receipt },
}

export default function GuidedTour({ tour, onClose, onCamera, onAmenities }: Props) {
  const { t: tRaw, i18n } = useTranslation('gate')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const zh = (i18n.language || 'en').startsWith('zh')
  const stops = tour.stops || []
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const isLast = idx >= stops.length - 1
  const stop = stops[idx]

  const go = useCallback((i: number) => {
    setIdx(Math.max(0, Math.min(stops.length - 1, i)))
    setProgress(0)
  }, [stops.length])

  // Per-stop map side effects (camera + amenity overlay)
  useEffect(() => {
    if (!stop) return
    if (stop.kind === 'environment' && stop.spokes?.length && stop.center) {
      onAmenities({ center: stop.center, centerName: tour.name, score: stop.score ?? 0, tier: stop.tier ?? '', spokes: stop.spokes })
    } else {
      onAmenities(null)
      // A project sits at a point → zoom in close; an area is large → frame wider.
      onCamera({ lat: tour.lat, lng: tour.lng, zoom: tour.kind === 'project' ? 15.4 : 12.8 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx])

  // Auto-advance with a smooth progress fill; pause freezes; stops on last stop.
  useEffect(() => {
    if (paused || isLast) return
    let raf = 0
    const dwell = DWELL_BY_KIND[stop.kind] ?? 7000
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dwell)
      setProgress(p)
      if (p >= 1) { go(idx + 1); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [idx, paused, isLast, go])

  // Clean up overlay when the tour closes
  useEffect(() => () => onAmenities(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!stop) return null

  return (
    <div
      className="fixed z-[9000] bg-white shadow-2xl ring-1 ring-slate-900/10
                 inset-x-0 bottom-0 rounded-t-2xl
                 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:bottom-5 md:w-[720px] md:max-w-[calc(100vw-2rem)] md:rounded-2xl
                 animate-[slideUp_.25s_ease-out]"
    >
      <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}@media(min-width:768px){@keyframes slideUp{from{transform:translate(-50%,120%)}to{transform:translate(-50%,0)}}}`}</style>

      {/* Header row: photo + title + progress dots + close */}
      <div className="flex items-center gap-3 px-4 pt-3">
        {tour.image ? (
          <img
            src={getImageUrl(tour.image, 'thumbnail')}
            alt={tour.name}
            className="h-9 w-9 flex-shrink-0 rounded-lg object-cover ring-1 ring-slate-900/10"
            loading="lazy"
          />
        ) : (
          <span className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0" />
        )}
        <div className="font-semibold text-sm text-slate-800 truncate">{tour.name}</div>
        <div className="ms-auto flex items-center gap-1.5">
          <button onClick={() => setPaused(p => !p)} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500" title={paused ? 'Play' : 'Pause'}>
            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress dots / stepper */}
      <div className="flex items-center gap-1.5 px-4 pt-2.5">
        {stops.map((s, i) => {
          const m = STOP_META[s.kind]
          const active = i === idx
          const doneStep = i < idx
          return (
            <button key={i} onClick={() => { setPaused(false); go(i) }} className="group flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                  active ? 'bg-teal-500 text-white' : doneStep ? 'bg-teal-100 text-teal-600' : 'bg-slate-200 text-slate-500'
                }`}>{i + 1}</span>
                <span className={`truncate text-xs font-medium ${active ? 'text-teal-600' : 'text-slate-400'}`}>{zh ? m.zh : m.en}</span>
              </div>
              <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-teal-500 transition-[width] duration-100 ease-linear"
                  style={{ width: active ? `${Math.round(progress * 100)}%` : doneStep ? '100%' : '0%' }} />
              </div>
            </button>
          )
        })}
      </div>

      {/* Narration line (台词) */}
      <div className="px-4 pt-3 text-sm leading-snug text-slate-700">
        <span className="me-1">🌙</span>{stop.line}
      </div>

      {/* Stop card */}
      <div className="px-4 py-3">
        <StopCard stop={stop} lang={i18n.language} />
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
        <button onClick={() => { setPaused(true); go(idx - 1) }} disabled={idx === 0}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent">
          <ChevronLeft className="w-4 h-4 rtl:-scale-x-100" />{t('gate:back')}
        </button>
        {isLast ? (
          <button onClick={onClose} className="inline-flex items-center gap-1 rounded-lg bg-teal-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-600">
            {t('gate:done')}
          </button>
        ) : (
          <button onClick={() => { setPaused(true); go(idx + 1) }}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-600">
            {t('gate:next')}<ChevronRight className="w-4 h-4 rtl:-scale-x-100" />
          </button>
        )}
      </div>
    </div>
  )
}

function StopCard({ stop, lang }: { stop: GuidedStop; lang: string }) {
  const t = (i18n.getFixedT as (l: string, ns: string) => (k: string, o?: Record<string, unknown>) => string)(lang, 'gate')
  if (stop.kind === 'advantages' && stop.metrics) {
    const m = stop.metrics
    const cell = (label: string, node: React.ReactNode) => (
      <div className="rounded-xl bg-slate-50 px-3 py-2">
        <div className="text-[11px] text-slate-400">{label}</div>
        <div className="mt-0.5 text-base font-bold text-slate-900 leading-tight">{node}</div>
      </div>
    )
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cell(t('gate:medianPrice'), m.medianUnitPrice != null ? <><DirhamSymbol size="0.7em" className="text-slate-400" />{formatMoneyCompact(m.medianUnitPrice, lang)}</> : '—')}
        {cell(t('gate:priceSqft'), m.pricePerSqm != null ? <><DirhamSymbol size="0.7em" className="text-slate-400" />{formatMoneyFull(pricePerSqmToPerSqft(m.pricePerSqm))}</> : '—')}
        {cell(t('gate:yield'), m.rentalYield != null ? <span className="text-emerald-600">{m.rentalYield.toFixed(1)}%</span> : '—')}
        {cell(t('gate:growth'), m.capitalGrowth != null ? <span className={m.capitalGrowth >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{m.capitalGrowth >= 0 ? '+' : ''}{m.capitalGrowth.toFixed(1)}%</span> : '—')}
      </div>
    )
  }
  if (stop.kind === 'environment' && stop.spokes?.length) {
    return (
      <div className="space-y-1.5">
        {stop.tier && (
          <div className="mb-1 text-xs text-slate-500">{t('gate:convenience')} <span className="font-semibold text-slate-800">{stop.score}/100 · {stop.tier}</span></div>
        )}
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {stop.spokes.slice(0, 6).map((s, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
              <span className="truncate text-slate-700"><span className="me-1">{s.emoji}</span>{s.label} · {s.name}</span>
              <span className="ms-2 flex-shrink-0 font-semibold text-slate-800">{s.distanceKm}km</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (stop.kind === 'transactions' && stop.sales?.length) {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-100 divide-y divide-slate-100">
        {stop.sales.slice(0, 4).map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800">{r.building || '—'}</div>
              <div className="text-[11px] text-slate-400">{r.date}{r.rooms ? ` · ${r.rooms}` : ''}{r.sizeSqm ? ` · ${r.sizeSqm}m²` : ''}</div>
            </div>
            <div className="flex-shrink-0 text-sm font-bold text-slate-900">
              <DirhamSymbol size="0.75em" className="text-slate-400" />{r.price != null ? formatMoneyCompact(r.price, lang) : '—'}
            </div>
          </div>
        ))}
      </div>
    )
  }
  return null
}
