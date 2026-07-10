import { useState, memo } from 'react'
import { Marker } from 'react-map-gl/maplibre'
import { Building2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MapPinProject } from '../../lib/api'
import { DubaiLandmark } from '../../types'
import { getImageUrl } from '../../lib/image-utils'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'

// ============================================================================
// Project Card Marker — ARO 式双层模型的「信息层」。
// 真值层 = MapViewMapLibre 里的 GL 圆点(所有项目永不消失);这张照片卡只在
// 屏幕空间放得下时显示(父层做碰撞检测),点圆点必弹本卡,点本卡进详情。
// 深色玻璃底 + 缩略图 + 项目名 + 起价,下缘小尾巴指向圆点。
// ============================================================================

export const ProjectCardMarker = memo(({ project, onClick, flashing, selected, compact, below }: {
  project: MapPinProject
  onClick?: (p: MapPinProject) => void
  flashing?: boolean
  /** 点圆点弹出的那张卡:抬高层级并加高亮描边,和自动展示的卡区分 */
  selected?: boolean
  /** 手机紧凑卡:小一号(小图+名+价),盒≈本体尺寸,一屏能塞更多且不溢出面板 */
  compact?: boolean
  /** 碰撞检测决定翻到圆点下方(躲开顶部/右上面板):锚点+尾巴方向翻转 */
  below?: boolean
}) => {
  const { i18n } = useTranslation()
  const lang = i18n.language || 'en'
  const isZh = lang.startsWith('zh')
  const isSoldOut = project.status === 'sold-out'
  const hasPrice = !isSoldOut && project.minPrice != null && isFinite(project.minPrice) && project.minPrice > 0

  const thumb = compact ? 36 : 44
  // 白卡 + 青色点缀,和站点(teal/light)风格一致;强阴影保证在卫星/浅色底图上也清晰。
  const cardBg = '#ffffff'
  // 干净的 CSS 三角小尾巴(取代原来带双描边的旋转方块"小嘴")。与卡片同色、
  // marginTop:-1 融进卡底,只露出很小一段箭头指向圆点。
  const tailSize = compact ? 6 : 7
  const tail = (
    <div
      style={{
        width: 0, height: 0,
        borderLeft: `${tailSize}px solid transparent`,
        borderRight: `${tailSize}px solid transparent`,
        ...(below
          ? { borderBottom: `${tailSize + 1}px solid ${cardBg}`, marginBottom: -1 }
          : { borderTop: `${tailSize + 1}px solid ${cardBg}`, marginTop: -1 }),
        filter: 'drop-shadow(0 2px 2px rgba(15,23,42,0.14))',
      }}
    />
  )

  return (
    <Marker
      longitude={project.lng}
      latitude={project.lat}
      // 上方摆卡=anchor bottom(卡在点上方);翻到下方=anchor top
      anchor={below ? 'top' : 'bottom'}
      offset={[0, below ? 6 : -6]}
      style={{ zIndex: selected ? 300 : flashing ? 200 : 4 }}
      onClick={(e) => {
        e.originalEvent.stopPropagation()
        onClick?.(project)
      }}
    >
      <div
        className="group cursor-pointer transition-transform duration-150 hover:scale-[1.04]"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        {/* Luna 正在讲这个项目时的呼吸环 */}
        {flashing && (
          <span
            className="animate-ping"
            style={{
              position: 'absolute', inset: '4px',
              borderRadius: 16,
              background: 'rgba(20,184,166,0.30)',
              pointerEvents: 'none',
            }}
          />
        )}
        {below && tail}
        <div
          className="flex items-center"
          style={{
            gap: compact ? 8 : 10,
            padding: compact ? '4px 11px 4px 4px' : '5px 13px 5px 5px',
            background: cardBg,
            borderRadius: 14,
            border: selected ? '2px solid #14b8a6' : '1px solid rgba(15,23,42,0.06)',
            boxShadow: selected
              ? '0 8px 24px rgba(20,184,166,0.28), 0 2px 6px rgba(15,23,42,0.14)'
              : '0 8px 22px rgba(15,23,42,0.20), 0 1px 3px rgba(15,23,42,0.12)',
          }}
        >
          {/* 缩略图 */}
          <div
            style={{
              width: thumb, height: thumb, borderRadius: 10, overflow: 'hidden',
              flexShrink: 0, background: '#e2e8f0',
            }}
          >
            {project.image ? (
              <img
                src={getImageUrl(project.image, 'thumbnail')}
                alt={project.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                loading="lazy"
              />
            ) : (
              <div style={{
                width: '100%', height: '100%', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, #ccfbf1 0%, #99f6e4 100%)',
              }}>
                <Building2 style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, color: '#0d9488' }} />
              </div>
            )}
          </div>
          {/* 名称 + 起价 */}
          <div style={{ minWidth: 0, paddingRight: 1 }}>
            <div
              style={{
                fontSize: compact ? 11.5 : 12.5, fontWeight: 700, color: '#0f172a',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                maxWidth: compact ? 96 : 124, lineHeight: compact ? '15px' : '16px',
                letterSpacing: '-0.01em',
              }}
            >
              {project.name}
            </div>
            {isSoldOut ? (
              <div style={{
                fontSize: compact ? 9.5 : 10, fontWeight: 800, color: '#dc2626',
                lineHeight: compact ? '13px' : '14px', letterSpacing: '0.03em',
              }}>
                {isZh ? '已售罄' : 'SOLD OUT'}
              </div>
            ) : hasPrice ? (
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 3,
                fontSize: compact ? 11 : 12, fontWeight: 800, color: '#0d9488',
                lineHeight: compact ? '15px' : '16px',
              }}>
                <span style={{ fontWeight: 600, fontSize: compact ? 9 : 10, color: '#94a3b8' }}>
                  {isZh ? '起' : 'From'}
                </span>
                <DirhamSymbol size="0.8em" />
                <span>{formatMoneyCompact(project.minPrice!, lang)}</span>
              </div>
            ) : (
              <div style={{ fontSize: compact ? 9.5 : 10, fontWeight: 600, color: '#94a3b8', lineHeight: compact ? '13px' : '14px' }}>
                {isZh ? '价格待定' : 'Price TBA'}
              </div>
            )}
          </div>
        </div>
        {!below && tail}
      </div>
    </Marker>
  )
})

// ============================================================================
// Landmark Marker - 3D 扣图建筑立在地图上（与项目卡片明确区分）
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
  // xlarge 是城市天际线主地标(哈利法塔)：抬到其它地标(zIndex 1)和项目卡(zIndex 4)
  // 之上,保证它永远不被旁边的图标/标签盖住。仍在选中卡(300)之下。
  const zIndex = isXl ? 5 : 1

  const langKey = i18n.language?.split('-')[0]
  const localizedName = (langKey && landmark.translations?.[langKey]?.name) || landmark.name

  return (
    <Marker
      longitude={landmark.location.lng}
      latitude={landmark.location.lat}
      anchor="bottom"
      // 普通地标垫在项目卡（zIndex 4）和选中卡（300）下面；xlarge 主地标(哈利法塔)
      // 抬高到 5 以免被旁边图标/标签盖住。
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
