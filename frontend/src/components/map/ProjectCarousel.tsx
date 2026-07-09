/**
 * 手机地图底部项目卡片轨(Airbnb/Zillow 模式)。
 *
 * 小屏上「把卡片浮在点上方」必然被碰撞检测挤到只剩一两张、还得砍掉图片——
 * 死路。改成:地图只留圆点(真值层),底部一条横滑卡片轨,带图/名/价/户型,
 * 一次滑得到全部项目。与地图三向联动(见 MapViewMapLibre 的 carousel 逻辑):
 *   点圆点 → 轨道滚到那张卡 + 高亮圆点
 *   滑轨道停稳 → 地图轻推到该项目 + 高亮圆点
 *   点卡片 → 进详情
 *
 * 性能:滚动不进 React 每帧(scroll-snap 原生 + settle 时才回调);卡片是静态
 * DOM,不订阅相机。
 */
import { memo } from 'react'
import { Building2, BedDouble, MapPin } from 'lucide-react'
import { MapPinProject } from '../../lib/api'
import { getImageUrl } from '../../lib/image-utils'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'
import { useTranslation } from 'react-i18next'

// 卡片宽度(含右侧 gap);MapViewMapLibre 的 scroll→index 换算要用同一个值。
export const CAROUSEL_CARD_W = 268
export const CAROUSEL_GAP = 12
const STEP = CAROUSEL_CARD_W + CAROUSEL_GAP

interface Props {
  projects: MapPinProject[]
  activeId: string | null
  scrollRef: React.RefObject<HTMLDivElement>
  onOpen: (p: MapPinProject) => void
  /** 点某张卡的卡身(非"查看")= 激活它(滚到中间并高亮圆点),再点一次才进详情 */
  onActivate: (id: string) => void
}

function bedsLabel(p: MapPinProject, isZh: boolean): string | null {
  const lo = p.minBeds, hi = p.maxBeds
  if (lo == null && hi == null) return null
  const one = (n: number) => (n === 0 ? (isZh ? '开间' : 'Studio') : isZh ? `${n}室` : `${n} BR`)
  if (lo != null && hi != null && lo !== hi) return isZh ? `${lo}-${hi}室` : `${lo}-${hi} BR`
  const n = (lo ?? hi)!
  return one(n)
}

const ProjectCarousel = memo(function ProjectCarousel({ projects, activeId, scrollRef, onOpen, onActivate }: Props) {
  const { i18n } = useTranslation()
  const lang = i18n.language || 'en'
  const isZh = lang.startsWith('zh')

  return (
    <div
      ref={scrollRef}
      className="pointer-events-auto flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1"
      style={{
        // 两侧留半屏留白,让首/末张也能 snap 到正中
        paddingLeft: `calc(50vw - ${CAROUSEL_CARD_W / 2}px)`,
        paddingRight: `calc(50vw - ${CAROUSEL_CARD_W / 2}px)`,
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <style>{`.pinzos-carousel::-webkit-scrollbar{display:none}`}</style>
      {projects.map(p => {
        const isSoldOut = p.status === 'sold-out'
        const hasPrice = !isSoldOut && p.minPrice != null && isFinite(p.minPrice) && p.minPrice > 0
        const active = p.id === activeId
        const beds = bedsLabel(p, isZh)
        return (
          <button
            key={p.id}
            data-cid={p.id}
            onClick={() => (active ? onOpen(p) : onActivate(p.id))}
            className="pinzos-carousel-card relative flex shrink-0 snap-center items-stretch overflow-hidden rounded-2xl bg-white text-left shadow-[0_8px_28px_rgba(0,0,0,0.28)] transition-transform"
            style={{
              width: CAROUSEL_CARD_W,
              transform: active ? 'translateY(-2px)' : 'none',
              outline: active ? '2px solid #14b8a6' : '1px solid rgba(15,23,42,0.06)',
              outlineOffset: active ? -2 : -1,
            }}
          >
            {/* 缩略图 */}
            <div className="relative h-[92px] w-[100px] shrink-0 bg-slate-200">
              {p.image ? (
                <img
                  src={getImageUrl(p.image, 'thumbnail')}
                  alt={p.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-300 to-slate-400">
                  <Building2 className="h-6 w-6 text-white/80" />
                </div>
              )}
              {isSoldOut && (
                <span className="absolute left-1.5 top-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                  {isZh ? '售罄' : 'SOLD'}
                </span>
              )}
            </div>
            {/* 信息 */}
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
              <div className="truncate text-[13px] font-bold leading-tight text-slate-900">{p.name}</div>
              {hasPrice ? (
                <div className="flex items-baseline gap-1 text-[13px] font-extrabold text-teal-600">
                  <span className="text-[10px] font-semibold text-slate-400">{isZh ? '起' : 'From'}</span>
                  <DirhamSymbol size="0.8em" />
                  <span>{formatMoneyCompact(p.minPrice!, lang)}</span>
                </div>
              ) : (
                <div className="text-[11px] font-medium text-slate-400">{isZh ? '价格待定' : 'Price TBA'}</div>
              )}
              <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-slate-500">
                {beds && (
                  <span className="flex items-center gap-0.5">
                    <BedDouble className="h-3 w-3" />{beds}
                  </span>
                )}
                {p.area && (
                  <span className="flex min-w-0 items-center gap-0.5">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{p.area}</span>
                  </span>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
})

export default ProjectCarousel
export { STEP as CAROUSEL_STEP }
