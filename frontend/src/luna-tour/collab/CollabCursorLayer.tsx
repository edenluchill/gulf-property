/**
 * Luna Collaborative Tour — global remote-cursor overlay (viewer side).
 *
 * A single fixed, viewport-covering, pointer-events-none layer (portaled to
 * <body> at a z-index ABOVE the project drawer / POI panels) that renders the
 * presenter's labelled cursor wherever they move — Figma-style presence that
 * works on EVERY surface, not just the map.
 *
 * ⭐ GEO-ANCHORED when the presenter's pointer is over the map: we re-project
 * their lng/lat EVERY FRAME, so the cursor sits on the SAME BUILDING no matter
 * the screen size or aspect. The agent presents on an iPad, the client watches on
 * a phone — viewport-normalized coords would point at completely different places
 * on the two devices. Falls back to normalized x/y off-map (drawers, panels),
 * where there is no geography to anchor to.
 *
 * Imperative DOM updates inside an rAF lerp — never React state per frame
 * (performance hard rule: zero re-render while the cursor moves).
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { CollabClient } from './CollabClient'
import type { ServerMsg } from './protocol'

const ACCENT = '#00E0B8'
const IDLE_MS = 4000

export interface CollabCursorLayerProps {
  client: CollabClient | null
  active: boolean
  /** presenter display name shown beside the cursor */
  label?: string
  /** live map — to re-project the presenter's geo anchor. Without it we degrade
   *  to viewport-normalized positioning (wrong across device sizes, but not broken). */
  getMap?: () => MaplibreMap | null | undefined
}

export default function CollabCursorLayer({ client, active, label, getMap }: CollabCursorLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLSpanElement>(null)
  const labelRef = useRef(label)
  const getMapRef = useRef(getMap)
  labelRef.current = label
  getMapRef.current = getMap

  useEffect(() => {
    if (!active || !client) return
    const cursor = cursorRef.current
    if (!cursor) return

    let raf: number | null = null
    let lastAt = 0
    let placed = false
    const cur = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const tgt = { x: cur.x, y: cur.y }
    /** last geo anchor from the presenter (null = they're off-map → use x/y) */
    let geo: { lng: number; lat: number } | null = null

    /** geo → screen, in viewport coords (the overlay is fixed to the viewport). */
    const projectGeo = (): { x: number; y: number } | null => {
      const map = getMapRef.current?.()
      const el = map?.getContainer()
      if (!map || !el || !geo) return null
      try {
        const p = map.project([geo.lng, geo.lat])
        const r = el.getBoundingClientRect()
        return { x: p.x + r.left, y: p.y + r.top }
      } catch {
        return null
      }
    }

    const loop = () => {
      raf = requestAnimationFrame(loop)
      // Re-project every frame: the viewer's map is still moving (following the
      // presenter's cam), so a screen position computed once would smear. The geo
      // anchor is the only thing that's stable across both devices.
      const g = projectGeo()
      if (g) { tgt.x = g.x; tgt.y = g.y }
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

      // Geo anchor wins whenever the presenter's pointer is over the map — it's
      // the only coordinate that means the same thing on an iPad and a phone.
      if (typeof m.lng === 'number' && typeof m.lat === 'number') {
        geo = { lng: m.lng, lat: m.lat }
        const g = projectGeo()
        if (g) { tgt.x = g.x; tgt.y = g.y }
      } else {
        // off-map (drawer / panel / toolbar): no geography → normalized fallback
        geo = null
        tgt.x = m.x * window.innerWidth
        tgt.y = m.y * window.innerHeight
      }

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
