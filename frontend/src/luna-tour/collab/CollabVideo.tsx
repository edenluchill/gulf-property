/**
 * Collab 带看视频窗 —— 悬浮画中画。
 *
 *   • presenter → 本地预览(镜头对没对准沙盘,他自己要看得见)
 *   • viewer    → 经纪的画面
 *
 * 可拖动、可收起、双击放大。经纪一关摄像头,remoteVideo 变 null → 整个窗消失。
 *
 * 布局铁律(见 memory: map-mobile-chrome-layout):
 *   • 默认停在**左下**,不碰右侧的指标卡/工具卡/Luna 药丸
 *   • z-[2100]:低于 CollabBar(z-[2150]),高于地图
 *   • **必须 createPortal 到 body** —— transform/backdrop-filter 容器内的 fixed
 *     元素会被裁掉(铁律:fixed-modal-portal-backdrop-filter)
 *
 * ISOLATION: 纯展示;删 collab 目录即移除。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Maximize2, Minimize2, Video } from 'lucide-react'
import type { ICameraVideoTrack, IRemoteVideoTrack } from 'agora-rtc-sdk-ng'

const ACCENT = '#00E0B8'

export interface CollabVideoProps {
  /** presenter 的本地预览轨 */
  local?: ICameraVideoTrack | null
  /** viewer 收到的经纪画面 */
  remote?: IRemoteVideoTrack | null
  /** presenter 正在切前后置 → 盖 loading(重建 track 有 ~300ms 黑屏) */
  flipping?: boolean
  isPresenter?: boolean
  /** presenter: 正在观看的客户数 */
  viewers?: number
}

export default function CollabVideo({ local, remote, flipping, isPresenter, viewers = 0 }: CollabVideoProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [big, setBig] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  const track = isPresenter ? local : remote

  // Agora 的 track.play() 直接挂进 DOM 节点(它自己建 <video>)。
  // 高频重渲染不参与 —— 这里只在 track 变化时 play/stop 一次。
  useEffect(() => {
    const el = boxRef.current
    if (!el || !track) return
    try { track.play(el, { fit: 'cover' }) } catch { /* ignore */ }
    return () => { try { track.stop() } catch { /* ignore */ } }
  }, [track])

  // 拖动(pointer events —— 经纪全在 iPad 上,不能只支持 mouse)
  useEffect(() => {
    if (!dragRef.current) return
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      setPos({ x: e.clientX - d.dx, y: e.clientY - d.dy })
    }
    const up = () => { dragRef.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  })

  if (!track) return null

  const size = big
    ? 'w-[min(40vw,520px)] h-[min(30vw,390px)]'
    : 'h-[120px] w-[160px] md:h-[180px] md:w-[240px]'

  return createPortal(
    <div
      className={`fixed z-[2100] ${size} overflow-hidden rounded-2xl bg-slate-900 shadow-2xl ring-1 ring-white/15 transition-[width,height]`}
      style={pos
        ? { left: pos.x, top: pos.y }
        // 默认左下:避开右侧的指标卡/工具卡/Luna。presenter 要让开底部导航。
        : { left: 16, bottom: isPresenter ? 128 : 88 }}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
        setPos({ x: r.left, y: r.top })
      }}
      onDoubleClick={() => setBig((v) => !v)}
    >
      {/* Agora 自己往这个节点里塞 <video> */}
      <div ref={boxRef} className="h-full w-full [&>video]:h-full [&>video]:w-full [&>video]:object-cover" />

      {flipping && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
      )}

      {/* 顶部条:身份 + 观看人数(presenter 要知道有几个人在看 —— 那是计费口径) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-2 py-1.5">
        <span className="flex items-center gap-1 text-[10px] font-medium text-white/90">
          <Video className="h-3 w-3" style={{ color: ACCENT }} />
          {isPresenter ? '你的镜头' : '经纪的镜头'}
        </span>
        {isPresenter && viewers > 0 && (
          <span className="rounded-full bg-black/40 px-1.5 text-[10px] tabular-nums text-white/90">
            {viewers} 人观看
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setBig((v) => !v) }}
        className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white/90 transition hover:bg-black/70"
        title={big ? '缩小' : '放大'}
      >
        {big ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>
    </div>,
    document.body,
  )
}
