import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
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

// 项目主标记:醒目的 teal 水滴 pin(尖端落点)
const projectIcon = L.divIcon({
  className: '',
  html: `<div style="width:26px;height:26px;background:#0d9488;border:2.5px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.45)"><div style="width:8px;height:8px;background:#fff;border-radius:50%;position:absolute;top:7px;left:7px;transform:rotate(45deg)"></div></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 26],
})

// 周边 POI 标记:分类色圆形 + 编号(和右侧列表的编号一一对应)
const numberedIcon = (n: number, color: string) =>
  L.divIcon({
    className: '',
    html: `<div style="background:${color};color:#fff;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${n}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })

// 地图加载后自动缩放到包含项目 + 所有周边点
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 14)
    } else {
      map.fitBounds(points, { padding: [42, 42], maxZoom: 15 })
    }
  }, [map, points])
  return null
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
  const commute = insights?.commute || []

  // 周边统一列表(地铁在前,然后各类 POI),编号 1..N —— 地图标记与右侧列表共用同一编号。
  const nearbyList = useMemo(
    () => [
      ...metro.map((m) => ({ ...m, category: 'metro_station' as const })),
      ...pois,
    ],
    [metro, pois]
  )
  // 有坐标的点才上图(后端按距离算,坐标齐全;个别缺失则只在列表显示)
  const mapped = nearbyList
    .map((p, i) => ({ ...p, n: i + 1 }))
    .filter((p) => p.lat != null && p.lng != null) as Array<typeof nearbyList[number] & { n: number; lat: number; lng: number }>
  const boundsPoints = useMemo<[number, number][]>(
    () => [[location.lat, location.lng], ...mapped.map((p) => [p.lat, p.lng] as [number, number])],
    [location.lat, location.lng, mapped]
  )

  return (
    <div className="space-y-5">
      {/* Map with project pin + numbered nearby POIs */}
      <div className="h-80 overflow-hidden rounded-2xl ring-1 ring-slate-900/[0.06]">
        <MapContainer center={[location.lat, location.lng]} zoom={14} scrollWheelZoom={false} className="h-full w-full">
          {/* CARTO Voyager:干净、拉丁字母标注,比原始 OSM(阿语)好看且更易读 */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={20}
          />
          <FitBounds points={boundsPoints} />
          <Marker position={[location.lat, location.lng]} icon={projectIcon} zIndexOffset={1000}>
            <Tooltip direction="top" offset={[0, -24]}>{buildingName}</Tooltip>
          </Marker>
          {mapped.map((p) => {
            const meta = metaFor(p.category)
            return (
              <Marker key={`${p.category}-${p.n}`} position={[p.lat, p.lng]} icon={numberedIcon(p.n, meta.color)}>
                <Tooltip direction="top" offset={[0, -12]}>
                  <span className="font-medium">{p.n}. {p.name}</span>
                  <span className="ml-1 text-slate-400">{zh ? meta.zh : meta.en} · {dist(p.distance_m, zh)}</span>
                </Tooltip>
              </Marker>
            )
          })}
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
          {nearbyList.length === 0 ? (
            <p className="text-xs text-slate-400">{zh ? '暂无周边数据' : 'No nearby data'}</p>
          ) : (
            <div className="space-y-2">
              {nearbyList.map((p, i) => {
                const meta = metaFor(p.category)
                const onMap = p.lat != null && p.lng != null
                const isMetro = p.category === 'metro_station'
                return (
                  <div key={`${p.category}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2 text-slate-600">
                      {/* 编号徽章:与地图标记同色同号(没坐标上不了图的退化成灰点) */}
                      {onMap ? (
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                          style={{ background: meta.color }}
                        >
                          {i + 1}
                        </span>
                      ) : (
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} />
                      )}
                      {isMetro && <Train className="h-3.5 w-3.5 shrink-0 text-indigo-500" />}
                      <span className="shrink-0 text-xs text-slate-400">{zh ? meta.zh : meta.en}</span>
                      <span className="truncate">{p.name}</span>
                      {(() => {
                        const r = (p as { khda_rating?: string }).khda_rating
                        if (!r) return null
                        const label = ({ outstanding: '卓越', 'very good': '优秀', good: '良好', acceptable: '合格', weak: '欠佳', 'very weak': '很差' } as Record<string, string>)[r.toLowerCase()] || r
                        return (
                          <span
                            title="KHDA 迪拜教育局官方督导评级 · 截至 2023-24 学年"
                            className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700"
                          >
                            KHDA {zh ? label : r}
                          </span>
                        )
                      })()}
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
