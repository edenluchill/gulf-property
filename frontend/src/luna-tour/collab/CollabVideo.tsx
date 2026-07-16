/**
 * Collab 带看视频窗 —— 悬浮画中画 + 全屏。
 *
 *   • presenter → 本地预览(镜头对没对准沙盘,他自己要看得见)
 *   • viewer    → 经纪的画面
 *
 * ⭐ **点一下就全屏** —— 客户看沙盘必须能放大看清。
 *   小窗 object-cover(填满不留边),全屏 object-contain(不裁掉画面任何一角)。
 *
 * 手势(移动端优先 —— 客户全在手机上):
 *   • 点击(位移 <6px)→ 全屏 / 退出全屏
 *   • 拖动(位移 ≥6px)→ 移动小窗,**不触发**点击
 *   ⚠️ 别用 onDoubleClick:移动端 Safari 压根不派发它。
 *   ⚠️ 别在容器上裸挂 onPointerDown 就当拖动:会把 click 一起吞掉(这是上一版的 bug)。
 *
 * 布局铁律(见 memory: map-mobile-chrome-layout):
 *   • 小窗默认停**左下**,不碰右侧的指标卡/工具卡/Luna 药丸
 *   • z-[2100] 小窗 / z-[2200] 全屏(盖过 CollabBar 的 z-[2150])
 *   • **必须 createPortal 到 body**(铁律:fixed-modal-portal-backdrop-filter)
 *
 * ISOLATION: 纯展示;删 collab 目录即移除。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Maximize2, Video, X } from 'lucide-react'
import type { ICameraVideoTrack, IRemoteVideoTrack } from 'agora-rtc-sdk-ng'

const ACCENT = '#00E0B8'
/** 位移超过这个像素数就算拖动,不算点击 */
const DRAG_THRESHOLD = 6

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
  const hostRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  /** 一次手势的状态:起点 + 是否已越过拖动阈值 */
  const gesture = useRef<{ sx: number; sy: number; ox: number; oy: number; dragging: boolean } | null>(null)

  const track = isPresenter ? local : remote

  // Agora 的 track.play() 自己往这个节点里塞 <video>。
  // 依赖 full:全屏切换要重新 play(fit 从 cover 换成 contain)。
  useEffect(() => {
    const el = hostRef.current
    if (!el || !track) return
    try { track.play(el, { fit: full ? 'contain' : 'cover' }) } catch { /* ignore */ }
    return () => { try { track.stop() } catch { /* ignore */ } }
  }, [track, full])

  // 全屏时锁掉小窗的拖动残留
  useEffect(() => { if (full) gesture.current = null }, [full])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (full) return
    const r = e.currentTarget.getBoundingClientRect()
    gesture.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, dragging: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }, [full])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.sx
    const dy = e.clientY - g.sy
    // 越过阈值才算拖动 —— 否则手指的轻微抖动会把「点击放大」吃掉
    if (!g.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    g.dragging = true
    setPos({ x: g.ox + dx, y: g.oy + dy })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    // 没拖动 = 点击 → 全屏。客户看沙盘就靠这一下。
    if (g && !g.dragging) setFull(true)
  }, [])

  if (!track) return null

  // ── 全屏:铺满 + object-contain(不裁画面)。客户放大看沙盘的主场景。 ──────
  if (full) {
    return createPortal(
      <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-black">
        <div ref={hostRef} className="h-full w-full [&>video]:h-full [&>video]:w-full [&>video]:object-contain" />

        {flipping && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <Loader2 className="h-8 w-8 animate-spin text-white" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-white/90">
            <Video className="h-4 w-4" style={{ color: ACCENT }} />
            {isPresenter ? '你的镜头' : '经纪的镜头'}
          </span>
          {isPresenter && viewers > 0 && (
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs tabular-nums text-white/90">
              {viewers} 人观看
            </span>
          )}
        </div>

        {/* 关闭:触摸友好的大热区(h-11) —— 手机上 24px 的按钮点不中 */}
        <button
          type="button"
          onClick={() => setFull(false)}
          className="absolute end-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
          title="退出全屏"
        >
          <X className="h-5 w-5" />
        </button>
      </div>,
      document.body,
    )
  }

  // ── 小窗:可拖 + 点击放大 ────────────────────────────────────────────────
  return createPortal(
    <div
      className="fixed z-[2100] h-[120px] w-[160px] cursor-pointer touch-none overflow-hidden rounded-2xl bg-slate-900 shadow-2xl ring-1 ring-white/15 md:h-[180px] md:w-[240px]"
      style={pos
        ? { left: pos.x, top: pos.y }
        // 默认左下:避开右侧的指标卡/工具卡/Luna。都抬高到底部 bar 之上。
        : { left: 16, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { gesture.current = null }}
    >
      <div ref={hostRef} className="h-full w-full [&>video]:h-full [&>video]:w-full [&>video]:object-cover" />

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
            {viewers}
          </span>
        )}
      </div>

      {/* 放大提示 —— 客户得看得出这里能点开(不是所有人都会去试着点画面) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent pb-1.5 pt-4 text-[10px] font-medium text-white/95">
        <Maximize2 className="h-3 w-3" /> 点击放大
      </div>
    </div>,
    document.body,
  )
}
