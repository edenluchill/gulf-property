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

export const ProjectCardMarker = memo(({ project, onClick, flashing, selected }: {
  project: MapPinProject
  onClick?: (p: MapPinProject) => void
  flashing?: boolean
  /** 点圆点弹出的那张卡:抬高层级并加高亮描边,和自动展示的卡区分 */
  selected?: boolean
}) => {
  const { i18n } = useTranslation()
  const lang = i18n.language || 'en'
  const isZh = lang.startsWith('zh')
  const isSoldOut = project.status === 'sold-out'
  const hasPrice = !isSoldOut && project.minPrice != null && isFinite(project.minPrice) && project.minPrice > 0

  return (
    <Marker
      longitude={project.lng}
      latitude={project.lat}
      anchor="bottom"
      // 卡片底部(尾巴尖)落在项目坐标上方一点,给 GL 圆点留出位置
      offset={[0, -10]}
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
              borderRadius: 14,
              background: 'rgba(16,185,129,0.35)',
              pointerEvents: 'none',
            }}
          />
        )}
        <div
          className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2.5 shadow-[0_6px_20px_rgba(0,0,0,0.4)] backdrop-blur-[6px]"
          style={{
            background: 'rgba(15,23,42,0.80)',
            border: selected ? '1.5px solid #2DD4BF' : '1px solid rgba(255,255,255,0.14)',
          }}
        >
          {/* 缩略图 */}
          <div
            style={{
              width: 44, height: 44, borderRadius: 9, overflow: 'hidden',
              flexShrink: 0, background: '#1e293b',
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
                background: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)',
              }}>
                <Building2 style={{ width: 18, height: 18, color: 'rgba(255,255,255,0.65)' }} />
              </div>
            )}
          </div>
          {/* 名称 + 起价 */}
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 12, fontWeight: 700, color: '#fff',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                maxWidth: 118, lineHeight: '16px',
              }}
            >
              {project.name}
            </div>
            {isSoldOut ? (
              <div style={{
                fontSize: 10, fontWeight: 800, color: '#f87171',
                lineHeight: '14px', letterSpacing: '0.03em',
              }}>
                {isZh ? '已售罄' : 'SOLD OUT'}
              </div>
            ) : hasPrice ? (
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 3,
                fontSize: 11.5, fontWeight: 800, color: '#2DD4BF', lineHeight: '15px',
              }}>
                <span style={{ fontWeight: 600, fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>
                  {isZh ? '起' : 'From'}
                </span>
                <DirhamSymbol size="0.8em" />
                <span>{formatMoneyCompact(project.minPrice!, lang)}</span>
              </div>
            ) : (
              <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.5)', lineHeight: '14px' }}>
                {isZh ? '价格待定' : 'Price TBA'}
              </div>
            )}
          </div>
        </div>
        {/* 指向圆点的小尾巴 */}
        <div
          style={{
            width: 10, height: 10, marginTop: -5,
            background: 'rgba(15,23,42,0.80)',
            borderRight: '1px solid rgba(255,255,255,0.14)',
            borderBottom: '1px solid rgba(255,255,255,0.14)',
            transform: 'rotate(45deg)',
          }}
        />
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
