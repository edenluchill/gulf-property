/**
 * Luna Collaborative Tour — global remote-cursor overlay (viewer side).
 *
 * A single fixed, viewport-covering, pointer-events-none layer (portaled to
 * <body> at a z-index ABOVE the project drawer / POI panels) that renders the
 * presenter's labelled cursor wherever they move — Figma-style presence that
 * works on EVERY surface, not just the map. Position comes from viewport-
 * normalized `cur` packets; a tap spawns a ripple.
 *
 * Imperative DOM updates inside an rAF lerp — never React state per frame
 * (performance hard rule: zero re-render while the cursor moves).
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CollabClient } from './CollabClient'
import type { ServerMsg } from './protocol'

const ACCENT = '#00E0B8'
const IDLE_MS = 4000

export interface CollabCursorLayerProps {
  client: CollabClient | null
  active: boolean
  /** presenter display name shown beside the cursor */
  label?: string
}

export default function CollabCursorLayer({ client, active, label }: CollabCursorLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLSpanElement>(null)
  const labelRef = useRef(label)
  labelRef.current = label

  useEffect(() => {
    if (!active || !client) return
    const cursor = cursorRef.current
    if (!cursor) return

    let raf: number | null = null
    let lastAt = 0
    let placed = false
    const cur = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const tgt = { x: cur.x, y: cur.y }

    const loop = () => {
      raf = requestAnimationFrame(loop)
      cur.x += (tgt.x - cur.x) * 0.3
      cur.y += (tgt.y - cur.y) * 0.3
      cursor.style.transform = `translate3d(${cur.x.toFixed(1)}px,${cur.y.toFixed(1)}px,0)`
      cursor.style.opacity = Date.now() - lastAt > IDLE_MS ? '0' : '1'
    }

    const ripple = (x: number, y: number) => {
      const host = layerRef.current
      if (!host) return
      const r = document.createElement('div')
      r.setAttribute('aria-hidden', 'true')
      r.style.cssText = [
        'position:absolute', 'pointer-events:none',
        `left:${x.toFixed(1)}px`, `top:${y.toFixed(1)}px`,
        'width:16px', 'height:16px', 'margin:-8px 0 0 -8px', 'border-radius:50%',
        `border:2px solid ${ACCENT}`, 'opacity:.9',
        'transform:scale(.4)', 'transition:transform .6s ease-out,opacity .6s ease-out',
      ].join(';')
      host.appendChild(r)
      requestAnimationFrame(() => { r.style.transform = 'scale(3)'; r.style.opacity = '0' })
      setTimeout(() => r.remove(), 650)
    }

    const onCur = (m: ServerMsg) => {
      if (m.k !== 'cur') return
      tgt.x = m.x * window.innerWidth
      tgt.y = m.y * window.innerHeight
      if (!placed) { cur.x = tgt.x; cur.y = tgt.y; placed = true }
      lastAt = Date.now()
      if (nameRef.current && labelRef.current && nameRef.current.textContent !== labelRef.current) {
        nameRef.current.textContent = labelRef.current
      }
      if (m.tap) ripple(tgt.x, tgt.y)
      if (raf == null) raf = requestAnimationFrame(loop)
    }

    const off = client.on('cur', onCur)
    return () => { off(); if (raf != null) cancelAnimationFrame(raf) }
  }, [active, client])

  if (!active) return null

  // z above ALL app overlays (bottom sheets / lightbox / toasts are z-[10000]) so
  // the presenter's cursor stays visible on every panel — Figma-style.
  return createPortal(
    <div ref={layerRef} aria-hidden className="pointer-events-none fixed inset-0 z-[100000] overflow-hidden">
      <div
        ref={cursorRef}
        style={{
          position: 'absolute', left: 0, top: 0, opacity: 0, willChange: 'transform',
          transform: 'translate3d(-100px,-100px,0)', transition: 'opacity .25s ease',
        }}
      >
        {/* caret */}
        <div style={{
          position: 'absolute', left: 0, top: 0, width: 15, height: 15, background: ACCENT,
          border: '1.5px solid #04211c', borderRadius: '2px 10px 10px 10px',
          transform: 'rotate(-90deg)', boxShadow: '0 2px 8px rgba(0,0,0,.45)',
        }} />
        {/* name pill */}
        <span ref={nameRef} style={{
          position: 'absolute', left: 17, top: 13, whiteSpace: 'nowrap',
          font: '600 11px/1 system-ui,sans-serif', color: '#04211c', background: ACCENT,
          padding: '3px 7px', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,.35)',
        }}>
          {label || '经纪'}
        </span>
      </div>
    </div>,
    document.body,
  )
}
