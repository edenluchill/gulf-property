import { useEffect, useRef } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'

/**
 * 指北针。两种形态,按断点各用各的(2026-07-11 用户要求:只有手机要「和 filter 融为一体」,
 * pad/桌面维持原来的独立圆盘,别跟着缩):
 *   - variant="chip":32px 小按钮,收进左上筛选卡当第一颗(只在 <md 渲染)
 *   - variant="disc":48px 独立圆盘(Google Earth 式),浮在搜索/筛选下方(只在 md+ 渲染)
 *
 * 针的旋转/倾斜走命令式 DOM transform:rotate/pitch 每帧触发,写 state 会把整棵
 * 地图组件树拖下水(铁律:高频相机值禁入 React state)。这里每帧只碰这一个小合成层。
 * 点击 easeTo 回正北(俯仰保留,3D 由右侧工具卡管)。
 */
export default function MapCompassButton({
  map,
  variant = 'chip',
}: {
  map: MaplibreMap | null
  variant?: 'chip' | 'disc'
}) {
  const needleRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!map) return
    const sync = () => {
      const el = needleRef.current
      if (!el) return
      el.style.transform = `rotate(${-map.getBearing()}deg) rotateX(${map.getPitch() * 0.6}deg)`
    }
    map.on('rotate', sync)
    map.on('pitch', sync)
    sync()
    return () => {
      map.off('rotate', sync)
      map.off('pitch', sync)
    }
  }, [map])

  const isDisc = variant === 'disc'

  return (
    <button
      type="button"
      onClick={() => map?.easeTo({ bearing: 0, duration: 500, essential: true })}
      aria-label="指北针,点击回正北"
      title="指北针"
      className={
        isDisc
          ? 'flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/95 shadow-lg ring-1 ring-slate-900/[0.06] backdrop-blur-sm transition-transform duration-150 active:scale-90'
          : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-all duration-150 active:scale-90 hover:bg-slate-100'
      }
    >
      <span ref={needleRef} className="block will-change-transform" style={{ transformStyle: 'preserve-3d' }}>
        {isDisc ? (
          <svg width={44} height={44} viewBox="0 0 48 48" aria-hidden="true">
            {/* 刻度环:E/S/W 短刻度,N 用大字标 */}
            <circle cx="24" cy="24" r="21.5" fill="none" stroke="#e2e8f0" strokeWidth="1.5" />
            <text x="24" y="14" textAnchor="middle" fontSize="12" fontWeight="800" fill="#ef4444" fontFamily="system-ui, sans-serif">N</text>
            <line x1="43" y1="24" x2="38.5" y2="24" stroke="#64748b" strokeWidth="2" />
            <line x1="24" y1="43" x2="24" y2="38.5" stroke="#64748b" strokeWidth="2" />
            <line x1="5" y1="24" x2="9.5" y2="24" stroke="#64748b" strokeWidth="2" />
            <polygon points="24,15.5 29,25.5 19,25.5" fill="#ef4444" />
            <polygon points="19,25.5 29,25.5 24,35.5" fill="#94a3b8" />
            <circle cx="24" cy="25.5" r="2.5" fill="#334155" />
          </svg>
        ) : (
          <svg width={30} height={30} viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="22" fill="none" stroke="#e2e8f0" strokeWidth="2" />
            <text x="24" y="15" textAnchor="middle" fontSize="14" fontWeight="800" fill="#ef4444" fontFamily="system-ui, sans-serif">N</text>
            <polygon points="24,16 30,26 18,26" fill="#ef4444" />
            <polygon points="18,26 30,26 24,36" fill="#94a3b8" />
            <circle cx="24" cy="26" r="2.5" fill="#334155" />
          </svg>
        )}
      </span>
    </button>
  )
}
