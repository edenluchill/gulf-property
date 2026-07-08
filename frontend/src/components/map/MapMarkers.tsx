import { useState, useRef, useCallback, memo } from 'react'
import { Marker } from 'react-map-gl/maplibre'
import { Building2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MapPinProject } from '../../lib/api'
import { DubaiLandmark } from '../../types'
import { getImageUrl } from '../../lib/image-utils'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'

// ============================================================================
// Project Pin Marker - Premium teardrop style with thumbnail
// ============================================================================

export const ProjectPinMarker = memo(({ project, onClick, flashing, pixelOffset }: {
  project: MapPinProject
  onClick?: (p: MapPinProject) => void
  flashing?: boolean
  /** 两个项目几乎重叠时由父层算好的推开位移(px)，让两个 pin 都露出来 */
  pixelOffset?: [number, number]
}) => {
  const { i18n } = useTranslation()
  const [isHovered, setIsHovered] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const isSoldOut = project.status === 'sold-out'
  // 起价直接标在 pin 名下(竞品对比结论:名字+价格双行,不点开就能比价)。
  // 售罄盘不显示起价(有 SOLD 角标,"起价"语义已失效)。纯静态 DOM,
  // 不引入任何 hover/相机高频路径,符合地图 perf 铁律。
  const lang = i18n.language || 'en'
  const showPrice = !isSoldOut && project.minPrice != null && isFinite(project.minPrice) && project.minPrice > 0

  const handleMouseEnter = useCallback(() => setIsHovered(true), [])
  const handleMouseLeave = useCallback(() => setIsHovered(false), [])

  return (
    <Marker
      longitude={project.lng}
      latitude={project.lat}
      anchor="bottom"
      offset={pixelOffset}
      // hover 时把整个 marker 容器抬到最上层——悬浮卡是 marker 的子元素，
      // 不抬容器的话会被 DOM 顺序靠后的其他 pin 压住（客户反馈）
      style={{ zIndex: isHovered ? 300 : 2 }}
      onClick={(e) => {
        e.originalEvent.stopPropagation()
        onClick?.(project)
      }}
    >
      <div
        ref={containerRef}
        className="cursor-pointer transition-all duration-200 hover:scale-110 hover:z-[100]"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.25))',
        }}
      >
        {/* 项目名常显——合伙人要求 pin 上直接看到项目名（不再 hover 才出现）。
            绝对定位在泪滴下方，不参与布局，pin 尖端仍精确落在坐标上。
            第二行 = 起价（有价才显示），中文「≥120万」/英文「From 1.2M」。 */}
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: '1px',
            padding: showPrice ? '2px 8px 3px' : '1px 7px',
            borderRadius: showPrice ? 10 : 999,
            background: 'rgba(255,255,255,0.9)',
            maxWidth: '140px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            pointerEvents: 'none',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: '10.5px',
              fontWeight: 700,
              color: '#1e293b',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: '15px',
            }}
          >
            {project.name}
          </div>
          {showPrice && (
            <div
              style={{
                fontSize: '10px',
                fontWeight: 800,
                color: '#0d9488',
                whiteSpace: 'nowrap',
                lineHeight: '13px',
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'center',
                gap: '2px',
              }}
            >
              {lang.startsWith('zh') ? (
                <>
                  <span style={{ fontWeight: 600 }}>≥</span>
                  <DirhamSymbol size="0.75em" />
                  <span>{formatMoneyCompact(project.minPrice!, lang)}</span>
                </>
              ) : (
                <>
                  <span style={{ fontWeight: 600 }}>From</span>
                  <DirhamSymbol size="0.75em" />
                  <span>{formatMoneyCompact(project.minPrice!, lang)}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Teardrop pin with image */}
        <div
          style={{
            position: 'relative',
            width: '46px',
            height: '58px',
          }}
        >
          {/* Flash ring — pulses when Luna is talking about THIS project, so the
              customer can see on the map which one she means. */}
          {flashing && (
            <span
              className="animate-ping"
              style={{
                position: 'absolute',
                top: '1px',
                left: '4px',
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: 'rgba(16,185,129,0.55)',
                pointerEvents: 'none',
              }}
            />
          )}
          {/* Teardrop shape SVG background - premium dark gradient */}
          <svg
            viewBox="0 0 46 58"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
            }}
          >
            <defs>
              <linearGradient id={`pinGrad-${project.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#1e293b" />
                <stop offset="50%" stopColor="#334155" />
                <stop offset="100%" stopColor="#1e293b" />
              </linearGradient>
            </defs>
            {/* Teardrop path */}
            <path
              d="M23 0C10.3 0 0 10.3 0 23c0 8.5 6.5 17 13 23.5 3.5 3.5 7 7 10 11.5 3-4.5 6.5-8 10-11.5 6.5-6.5 13-15 13-23.5C46 10.3 35.7 0 23 0z"
              fill={`url(#pinGrad-${project.id})`}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="1.5"
            />
            {/* Inner highlight */}
            <path
              d="M23 3C12 3 3 12 3 23c0 7 5.5 14.5 11 20"
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </svg>

          {/* Circular image inside teardrop */}
          <div
            style={{
              position: 'absolute',
              top: '7px',
              left: '7px',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              overflow: 'hidden',
              border: '2px solid rgba(255,255,255,0.8)',
              background: '#1e293b',
            }}
          >
            {project.image ? (
              <img
                src={getImageUrl(project.image, 'thumbnail')}
                alt={project.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
                loading="lazy"
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)',
                }}
              >
                <Building2 style={{ width: '16px', height: '16px', color: 'rgba(255,255,255,0.7)' }} />
              </div>
            )}
          </div>

          {/* Sold Out badge - small red circle at top-right */}
          {isSoldOut && (
            <div
              style={{
                position: 'absolute',
                top: '2px',
                right: '-2px',
                background: '#dc2626',
                color: '#fff',
                fontSize: '7px',
                fontWeight: 700,
                padding: '2px 4px',
                borderRadius: '4px',
                border: '1.5px solid #fff',
                lineHeight: 1,
                letterSpacing: '0.02em',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}
            >
              SOLD
            </div>
          )}
        </div>
      </div>
    </Marker>
  )
})

// ============================================================================
// Cluster Bubble - round count badge for grouped project pins (supercluster).
// Click zooms in to split the group apart so every pin becomes reachable.
// ============================================================================

export const ClusterBubble = memo(({ count, minPrice, maxPrice, lng, lat, onClick }: {
  count: number; minPrice: number | null; maxPrice: number | null; lng: number; lat: number; onClick: () => void
}) => {
  const { i18n } = useTranslation()
  const lang = i18n.language || 'en'
  const isZh = lang.startsWith('zh')
  // Count circle grows a touch with group size.
  const circle = count >= 100 ? 30 : count >= 25 ? 27 : count >= 10 ? 25 : 22
  const hasPrice = minPrice != null && isFinite(minPrice) && minPrice > 0
  // Show a real range when min/max meaningfully differ; else a single figure.
  const hasRange = hasPrice && maxPrice != null && isFinite(maxPrice) && maxPrice > minPrice! * 1.02
  return (
    <Marker longitude={lng} latitude={lat} anchor="center" style={{ zIndex: 3 }}
      onClick={(e) => { e.originalEvent.stopPropagation(); onClick() }}>
      <div
        className="group flex cursor-pointer select-none items-center gap-1.5 rounded-full py-[3px] pl-[3px] pr-3 shadow-[0_6px_20px_rgba(0,0,0,0.35)] ring-1 ring-white/10 transition-transform hover:scale-105"
        style={{ background: 'rgba(15,23,42,0.82)', backdropFilter: 'blur(6px)' }}
      >
        {/* count badge — solid brand teal, the part the user said is fine */}
        <span
          className="flex items-center justify-center rounded-full font-bold leading-none text-white"
          style={{
            width: circle, height: circle,
            background: 'linear-gradient(135deg, #00E0B8 0%, #0d9488 100%)',
            boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.4)',
            fontSize: count >= 100 ? 12.5 : 12,
            color: '#06302b',
          }}
        >
          {count}
        </span>
        {/* price range — or N/A when the group has no priced project */}
        <span className="flex items-baseline gap-0.5 whitespace-nowrap leading-none text-white">
          {hasPrice ? (
            <>
              <DirhamSymbol size="0.78em" className="text-[#00E0B8]" />
              <span className="text-[12px] font-bold tracking-tight">{formatMoneyCompact(minPrice!, lang)}</span>
              {hasRange && (
                <>
                  <span className="mx-[3px] text-[12px] font-semibold text-slate-400">~</span>
                  <span className="text-[12px] font-bold tracking-tight">{formatMoneyCompact(maxPrice!, lang)}</span>
                </>
              )}
            </>
          ) : (
            <span className="text-[11px] font-medium text-slate-300">{isZh ? '暂无报价' : 'N/A'}</span>
          )}
        </span>
      </div>
    </Marker>
  )
})

// ============================================================================
// Landmark Marker - 3D 扣图建筑立在地图上（与项目 teardrop pin 明确区分）
// ============================================================================

// 本地扣图资源：frontend/public/landmarks/<slug>.png（透明背景 3D 微缩建筑）。
// 命中扣图 → 建筑直接"立"在地图上 + 名称标签；没有 → 退回金圈圆形照片。
const landmarkSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export const LandmarkMarker = memo(({ landmark, onClick }: {
  landmark: DubaiLandmark
  onClick?: (lm: DubaiLandmark) => void
}) => {
  const { i18n } = useTranslation()
  // 扣图加载失败(404/无此地标)时退回圆形照片样式
  const [cutoutFailed, setCutoutFailed] = useState(false)
  // 尺寸收紧：之前 84/68/54 在 z10 全城视野下太抢眼（客户反馈"挤着很乱"）
  // xlarge 专给哈利法塔等关键标志塔楼（窄高，放大不显臃肿）
  const isXl = landmark.size === 'xlarge'
  const cutoutH = isXl ? 132 : landmark.size === 'large' ? 64 : landmark.size === 'small' ? 42 : 52
  const pinSize = isXl ? 64 : landmark.size === 'large' ? 48 : landmark.size === 'small' ? 32 : 40
  // xlarge 是城市天际线主地标(哈利法塔)：抬到其它地标(zIndex 1)和项目 pin(zIndex 2)
  // 之上,保证它永远不被旁边的图标/标签盖住。仍在悬浮卡(300)之下。
  const zIndex = isXl ? 5 : 1

  const langKey = i18n.language?.split('-')[0]
  const localizedName = (langKey && landmark.translations?.[langKey]?.name) || landmark.name

  return (
    <Marker
      longitude={landmark.location.lng}
      latitude={landmark.location.lat}
      anchor="bottom"
      // 普通地标垫在项目 pin（zIndex 2）和悬浮卡（300）下面；xlarge 主地标(哈利法塔)
      // 抬高到最上(zIndex 5)以免被旁边图标/标签盖住。
      style={{ zIndex }}
      onClick={(e) => {
        e.originalEvent.stopPropagation()
        onClick?.(landmark)
      }}
    >
      {/* Outer wrapper scales with zoom via the map-level --lm-scale CSS var
          (set imperatively on zoom; no React re-render). Inner div keeps the
          hover affordance so the two transforms compose. */}
      <div style={{ transform: 'scale(var(--lm-scale, 1))', transformOrigin: 'bottom center', transition: 'transform 0.25s ease' }}>
      <div
        className="cursor-pointer transition-transform duration-150 hover:scale-110"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        {/* 名称标签放建筑上方（本地化），轻量小药丸，避免压住地图 */}
        <div
          style={{
            marginBottom: 1,
            padding: '1px 6px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.88)',
            fontSize: 10,
            fontWeight: 600,
            color: '#334155',
            whiteSpace: 'nowrap',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
            lineHeight: '14px',
          }}
        >
          {localizedName}
        </div>
        {!cutoutFailed ? (
          <img
            src={`/landmarks/${landmarkSlug(landmark.name)}.png`}
            alt={landmark.name}
            onError={() => setCutoutFailed(true)}
            style={{
              height: cutoutH,
              width: 'auto',
              maxWidth: cutoutH * 1.3,
              objectFit: 'contain',
              filter: 'drop-shadow(0 6px 8px rgba(0,0,0,0.35))',
            }}
            loading="lazy"
          />
        ) : (
          <div
            style={{
              width: pinSize,
              height: pinSize,
              borderRadius: '50%',
              overflow: 'hidden',
              border: '2.5px solid #f59e0b',
              boxShadow: '0 1px 4px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.12)',
              background: landmark.imageUrl ? '#f1f5f9' : '#334155',
            }}
          >
            {landmark.imageUrl ? (
              <img
                src={landmark.imageUrl}
                alt={landmark.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                loading="lazy"
              />
            ) : (
              <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Building2 style={{ width: pinSize * 0.45, height: pinSize * 0.45, color: 'rgba(255,255,255,0.8)' }} />
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </Marker>
  )
})
