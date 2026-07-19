/**
 * 房价涨幅 vs IRR 散点 —— 2000 点,用 <canvas>。
 *
 * 唯一一张不用 SVG 的图:2000 个 <circle> 元素会让布局/合成明显掉帧(手机上尤其),
 * 而 canvas 画 2000 个点是一次 fill 循环。DPR 缩放要自己做,否则在 2x 屏上糊。
 */
import { useEffect, useRef } from 'react'

interface Props {
  points: { g: number; irr: number }[]
  height?: number
}

export default function ScatterCanvas({ points, height = 220 }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const cvsRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const cvs = cvsRef.current
    if (!wrap || !cvs) return

    const draw = () => {
      const cssW = wrap.clientWidth
      if (!cssW) return
      // 手机 DPR 常是 3;2000 个点没必要按 3x 画,封顶 2 省 GPU/内存
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      cvs.width = Math.round(cssW * dpr)
      cvs.height = Math.round(height * dpr)
      cvs.style.width = `${cssW}px`
      cvs.style.height = `${height}px`
      const ctx = cvs.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, height)
      if (!points.length) return

      const PAD = { t: 8, r: 8, b: 22, l: 36 }
      const gs = points.map((p) => p.g)
      const rs = points.map((p) => p.irr)
      const gLo = Math.min(...gs)
      const gHi = Math.max(...gs)
      const rLo = Math.min(...rs)
      const rHi = Math.max(...rs)
      const gSpan = gHi - gLo || 0.01
      const rSpan = rHi - rLo || 0.01
      const plotW = cssW - PAD.l - PAD.r
      const plotH = height - PAD.t - PAD.b
      const sx = (g: number) => PAD.l + ((g - gLo) / gSpan) * plotW
      const sy = (r: number) => PAD.t + (1 - (r - rLo) / rSpan) * plotH

      // 网格 + 轴标
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 1
      ctx.fillStyle = '#94a3b8'
      ctx.font = '10px system-ui, sans-serif'
      ctx.textAlign = 'right'
      for (const f of [0, 0.5, 1]) {
        const v = rLo + rSpan * f
        const y = sy(v)
        ctx.beginPath()
        ctx.moveTo(PAD.l, y)
        ctx.lineTo(cssW - PAD.r, y)
        ctx.stroke()
        ctx.fillText(`${(v * 100).toFixed(0)}%`, PAD.l - 4, y + 3.5)
      }
      ctx.textAlign = 'center'
      for (const f of [0, 0.5, 1]) {
        const v = gLo + gSpan * f
        ctx.fillText(`${(v * 100).toFixed(0)}%`, sx(v), height - 6)
      }

      // 盈亏平衡线
      if (rLo < 0 && rHi > 0) {
        ctx.strokeStyle = '#fca5a5'
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(PAD.l, sy(0))
        ctx.lineTo(cssW - PAD.r, sy(0))
        ctx.stroke()
        ctx.setLineDash([])
      }

      for (const p of points) {
        ctx.fillStyle = p.irr < 0 ? 'rgba(248,113,113,0.5)' : 'rgba(13,148,136,0.35)'
        ctx.beginPath()
        ctx.arc(sx(p.g), sy(p.irr), 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [points, height])

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={cvsRef} className="block w-full" />
    </div>
  )
}
