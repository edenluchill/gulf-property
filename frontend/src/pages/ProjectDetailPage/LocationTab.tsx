import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import { MapPin, Clock, Train } from 'lucide-react'
import { ProjectInsights, fetchAreaInsights, AreaInsights } from '../../lib/api'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../../components/DirhamSymbol'

interface LocationTabProps {
  buildingName: string
  areaName: string
  location: { lat: number; lng: number }
  insights?: ProjectInsights | null
}

// POI category → marker colour + bilingual label.
const POI_META: Record<string, { color: string; zh: string; en: string }> = {
  metro_station: { color: '#6366f1', zh: '地铁', en: 'Metro' },
  hospital: { color: '#ef4444', zh: '医院', en: 'Hospital' },
  school: { color: '#f59e0b', zh: '学校', en: 'School' },
  university: { color: '#3b82f6', zh: '大学', en: 'University' },
  mall: { color: '#ec4899', zh: '商场', en: 'Mall' },
  supermarket: { color: '#22c55e', zh: '超市', en: 'Supermarket' },
  park: { color: '#10b981', zh: '公园', en: 'Park' },
  beach: { color: '#06b6d4', zh: '海滩', en: 'Beach' },
  gym: { color: '#8b5cf6', zh: '健身', en: 'Gym' },
}
const metaFor = (c: string) => POI_META[c] || { color: '#64748b', zh: c, en: c }

function dist(m: number, zh: boolean): string {
  if (m < 1000) return `${m} m`
  return `${(m / 1000).toFixed(1)} km${m <= 1500 ? (zh ? ' · 步行可达' : ' · walkable') : ''}`
}

export function LocationTab({ buildingName, areaName, location, insights }: LocationTabProps) {
  const { i18n } = useTranslation()
  const zh = i18n.language?.startsWith('zh')
  const [sales, setSales] = useState<AreaInsights['recentTransactions']>([])

  const areaId = insights?.area?.id
  useEffect(() => {
    if (!areaId) {
      setSales([])
      return
    }
    let alive = true
    fetchAreaInsights(areaId)
      .then((d) => alive && setSales(d?.recentTransactions?.slice(0, 6) || []))
      .catch(() => alive && setSales([]))
    return () => {
      alive = false
    }
  }, [areaId])

  const metro = insights?.nearby?.metro || []
  const pois = insights?.nearby?.pois || []
  const landmarks = insights?.nearby?.landmarks || []
  const commute = insights?.commute || []

  return (
    <div className="space-y-5">
      {/* Map with nearby markers */}
      <div className="h-80 overflow-hidden rounded-2xl ring-1 ring-slate-900/[0.06]">
        <MapContainer center={[location.lat, location.lng]} zoom={14} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={[location.lat, location.lng]}>
            <Popup>{buildingName}</Popup>
          </Marker>
          {/* Nearby POIs as coloured dots (positions approximated radially since we
              only have distances, not coords — kept near the project for context). */}
        </MapContainer>
      </div>

      {/* Commute + nearby */}
      <div className="grid gap-4 md:grid-cols-2">
        {commute.length > 0 && (
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Clock className="h-4 w-4 text-slate-400" /> {zh ? '通勤时间（估算）' : 'Commute (est.)'}
            </h3>
            <div className="space-y-2">
              {commute.map((c) => (
                <div key={c.hub} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{c.hub}</span>
                  <span className="font-medium text-slate-800">{c.mins_est} min</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <MapPin className="h-4 w-4 text-slate-400" /> {zh ? '周边' : 'Nearby'}
          </h3>
          {metro.length === 0 && pois.length === 0 && landmarks.length === 0 ? (
            <p className="text-xs text-slate-400">{zh ? '暂无周边数据' : 'No nearby data'}</p>
          ) : (
            <div className="space-y-2">
              {metro.map((m, i) => (
                <div key={`m${i}`} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5 text-slate-600">
                    <Train className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                    <span className="truncate">{m.name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">{dist(m.distance_m, zh)}</span>
                </div>
              ))}
              {pois.map((p, i) => {
                const meta = metaFor(p.category)
                return (
                  <div key={`p${i}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5 text-slate-600">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} />
                      <span className="text-xs text-slate-400">{zh ? meta.zh : meta.en}</span>
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">{dist(p.distance_m, zh)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent comparable sales (investment proof) */}
      {sales.length > 0 && (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">
            {zh ? '附近真实成交（同区近期）' : 'Recent area sales'}
          </h3>
          <div className="divide-y divide-slate-50">
            {sales.map((s, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <span className="text-slate-700">{s.building || areaName}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    {s.rooms || ''} {s.sizeSqm ? `· ${Math.round(s.sizeSqm)} m²` : ''} · {s.saleType === 'offplan' ? (zh ? '期房' : 'Off-plan') : zh ? '现房' : 'Ready'}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  {s.price != null && (
                    <div className="font-medium text-slate-800">
                      <DirhamSymbol size="0.8em" className="mr-0.5 text-slate-400" />
                      {formatMoneyCompact(s.price, i18n.language)}
                    </div>
                  )}
                  {s.pricePerSqm != null && (
                    <div className="text-[11px] text-slate-400">
                      <DirhamSymbol size="0.75em" className="mr-0.5" />
                      {Math.round(s.pricePerSqm).toLocaleString()}/m²
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {insights?.area?.data_through && (
            <p className="mt-2 text-[11px] text-slate-400">
              {zh ? `数据截止 ${insights.area.data_through} · 来源 DLD` : `Through ${insights.area.data_through} · DLD`}
            </p>
          )}
        </div>
      )}

      {/* Address fallback */}
      <div className="rounded-2xl bg-slate-50 p-4">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <div className="font-semibold text-slate-800">{buildingName}</div>
            <div className="text-sm text-slate-600">{areaName}, Dubai</div>
          </div>
        </div>
      </div>
    </div>
  )
}
