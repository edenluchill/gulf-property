/**
 * `/tours` —— 楼盘导览目录。
 *
 * owner 的话:「navigation bar 那里有 list of available 的 tour 能排序，
 * 客户就能看到有哪些新的有意思的 tour 能看。」
 *
 * 🔴 **默认排序里没有「热度」,这是刻意的。**
 * 一个全是 0 次播放的热度榜等于公开宣布「这里没人」—— 比不排序更糟。等真有播放量了
 * 再把它加成一个排序项(后端已经在返回 `plays`)。
 *
 * 🔴 **排序项只用填充率好的字段。**
 * 49 个可做导览的楼盘里:区域 46 个有、户型数 49 个全有、起价只有 27 个、
 * 交付日期只有 17 个。所以有「起价」但把没价的排在最后并明说「价格待公布」,
 * 而**没有「按交付时间」** —— 三分之二是空的排序项看起来就是坏的。
 *
 * ISOLATION: 只读 /api/luna/public/project-tours。删掉这个文件 + App 里那条路由
 * + Header/MobileNav 里的入口即可移除。
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet-async'
import { Play, MapPin, Building2, Bed, Compass } from 'lucide-react'
import { fetchProjectTours, tourDurationLabel, tourWatchUrl, type ProjectTour } from '../luna-tour/projectTours'
import { formatMoneyCompact } from '../lib/money'
import DirhamSymbol from '../components/DirhamSymbol'
import { trackEvent } from '../lib/track'

const SITE = 'https://www.pinzos.com'

type SortKey = 'newest' | 'price' | 'units' | 'name'

export default function ToursPage() {
  const { t } = useTranslation(['lunaTour'])
  const [tours, setTours] = useState<ProjectTour[] | null>(null)
  const [sort, setSort] = useState<SortKey>('newest')
  const [area, setArea] = useState<string>('')

  useEffect(() => {
    fetchProjectTours().then(setTours)
  }, [])

  const areas = useMemo(() => {
    const set = new Set<string>()
    for (const x of tours ?? []) if (x.area) set.add(x.area)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [tours])

  const shown = useMemo(() => {
    let list = [...(tours ?? [])]
    if (area) list = list.filter((x) => x.area === area)
    list.sort((a, b) => {
      switch (sort) {
        case 'price':
          // 没标价的一律排最后 —— 「价格待公布」不该混在最便宜那一头
          if (a.min_price == null && b.min_price == null) return 0
          if (a.min_price == null) return 1
          if (b.min_price == null) return -1
          return a.min_price - b.min_price
        case 'units':
          return b.unit_count - a.unit_count
        case 'name':
          return a.project_name.localeCompare(b.project_name)
        default:
          // featured 是人工策展权重(后端也按它排),再按上线时间
          if (b.featured !== a.featured) return b.featured - a.featured
          return (b.published_at ?? '').localeCompare(a.published_at ?? '')
      }
    })
    return list
  }, [tours, sort, area])

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'newest', label: t('lunaTour:projectTours.sortNewest') },
    { key: 'price', label: t('lunaTour:projectTours.sortPrice') },
    { key: 'units', label: t('lunaTour:projectTours.sortUnits') },
    { key: 'name', label: t('lunaTour:projectTours.sortName') },
  ]

  return (
    <>
      <Helmet>
        <title>{`${t('lunaTour:projectTours.pageTitle')} | Pinzos`}</title>
        <meta name="description" content={t('lunaTour:projectTours.pageLead')} />
        <link rel="canonical" href={`${SITE}/tours`} />
      </Helmet>

      <div className="flex-1 overflow-auto bg-slate-50">
        {/* hero */}
        <div className="border-b bg-white">
          <div className="container mx-auto px-4 py-7 sm:py-9">
            <div className="flex items-center gap-2 text-teal-700">
              <Compass className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-wider">Luna</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
              {t('lunaTour:projectTours.pageTitle')}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-[15px]">
              {t('lunaTour:projectTours.pageLead')}
            </p>
            {!!tours?.length && (
              <p className="mt-3 text-xs text-slate-400" translate="no">
                {t('lunaTour:projectTours.count', { n: shown.length })}
              </p>
            )}
          </div>
        </div>

        {/* 排序 + 区域筛选 */}
        {!!tours?.length && (
          <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur-sm">
            <div className="container mx-auto flex flex-wrap items-center gap-2 px-4 py-2.5">
              <div className="flex flex-wrap gap-1">
                {sortOptions.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => setSort(o.key)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      sort === o.key
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {areas.length > 1 && (
                <select
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="ms-auto rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                >
                  <option value="">{t('lunaTour:projectTours.areaAll')}</option>
                  {areas.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        <div className="container mx-auto px-4 py-6">
          {tours === null ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-64 animate-pulse rounded-2xl bg-white shadow-sm" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="rounded-2xl bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
              {t('lunaTour:projectTours.empty')}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((x) => (
                <TourCard key={x.project_id} tour={x} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// i18n 在卡片里自己取 —— 把 TFunction 当 prop 传下来会撞上 i18next 的键名字面量类型。
function TourCard({ tour }: { tour: ProjectTour }) {
  const { t, i18n } = useTranslation(['lunaTour'])
  const lang = i18n.language || 'en'
  const dur = tourDurationLabel(tour.duration_ms, lang)
  return (
    <Link
      to={tourWatchUrl(tour.share_code)}
      onClick={() =>
        trackEvent('tour_entry_click', {
          project_id: tour.project_id,
          share_code: tour.share_code,
          from: 'directory',
        })
      }
      className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.04] transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
        {tour.image ? (
          <img
            src={tour.image}
            alt={tour.project_name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-300">
            <Building2 className="h-10 w-10" />
          </div>
        )}
        {/* 播放键 —— 一眼看出这是能看的东西 */}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-transform group-hover:scale-110">
            <Play className="h-5 w-5 translate-x-[1px] fill-current rtl:-scale-x-100" />
          </span>
        </span>
        {dur && (
          <span
            translate="no"
            className="absolute bottom-2 end-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-semibold text-white"
          >
            {dur}
          </span>
        )}
      </div>

      <div className="p-3.5">
        <h2 className="truncate text-[15px] font-bold text-slate-900">{tour.project_name}</h2>
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
          {tour.area && (
            <span className="flex min-w-0 items-center gap-1">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{tour.area}</span>
            </span>
          )}
          {tour.developer && (
            <span className="flex min-w-0 items-center gap-1">
              <Building2 className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{tour.developer}</span>
            </span>
          )}
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          {/* 起价只有一半的盘有 —— 没有就明说「待公布」,不要留白 */}
          {tour.min_price != null ? (
            /* 「起」在中文里跟在数字后，其他语言里在数字前（from / dès / от / من）。
               金额本身走 DirhamSymbol + formatMoneyCompact（全站唯一口径）。 */
            <span className="flex items-center gap-1 text-sm font-bold text-slate-900" translate="no">
              {!lang.startsWith('zh') && (
                <span className="text-[11px] font-normal text-slate-400">
                  {t('lunaTour:projectTours.priceFromWord')}
                </span>
              )}
              <DirhamSymbol />
              {formatMoneyCompact(tour.min_price, lang)}
              {lang.startsWith('zh') && (
                <span className="text-[11px] font-normal text-slate-400">
                  {t('lunaTour:projectTours.priceFromWord')}
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs text-slate-400">{t('lunaTour:projectTours.priceTba')}</span>
          )}
          {tour.unit_count > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500" translate="no">
              <Bed className="h-3 w-3" />
              {t('lunaTour:projectTours.unitsN', { n: tour.unit_count })}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
