import { useEffect, useRef } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'

/**
 * 指北针 —— 收进左上筛选卡里的一颗按钮(2026-07-11 用户要求「跟 filter 融为一体」,
 * 原来在左下角孤零零一个 48px 圆盘)。
 *
 * 针的旋转/倾斜走命令式 DOM transform:rotate/pitch 每帧触发,写 state 会把整棵
 * 地图组件树拖下水(铁律:高频相机值禁入 React state)。这里每帧只碰这一个小合成层。
 * 点击 easeTo 回正北(俯仰保留,3D 由右侧工具卡管)。
 */
export default function MapCompassButton({ map }: { map: MaplibreMap | null }) {
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

  return (
    <button
      type="button"
      onClick={() => map?.easeTo({ bearing: 0, duration: 500, essential: true })}
      aria-label="指北针,点击回正北"
      title="指北针"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-all duration-150 active:scale-90 hover:bg-slate-100"
    >
      <span ref={needleRef} className="block will-change-transform" style={{ transformStyle: 'preserve-3d' }}>
        <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="21" fill="none" stroke="#e2e8f0" strokeWidth="2.5" />
          <text x="24" y="15" textAnchor="middle" fontSize="14" fontWeight="800" fill="#ef4444" fontFamily="system-ui, sans-serif">N</text>
          <polygon points="24,16 30,26 18,26" fill="#ef4444" />
          <polygon points="18,26 30,26 24,36" fill="#94a3b8" />
          <circle cx="24" cy="26" r="2.5" fill="#334155" />
        </svg>
      </span>
    </button>
  )
}
