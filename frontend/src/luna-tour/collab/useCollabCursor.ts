/**
 * Luna Collaborative Tour — live cursor (presenter → viewers), Figma-style.
 *
 * One wire format (`cur`; the server already fans it out verbatim — no backend
 * change needed). Two hooks:
 *   • useCollabPresenterCursor — samples the presenter's pointer over the map,
 *     UN-PROJECTS it to a lng/lat anchor, throttles to ~25Hz, emits `cur`. A
 *     pointerdown also emits `cur{tap}` so a phone presenter (no hover) still
 *     shows clients "what I'm tapping".
 *   • useCollabRemoteCursor — renders a labelled cursor that RE-PROJECTS the
 *     lng/lat every frame, so it sits on the SAME building on any screen size
 *     (a desktop-wide presenter and a tall phone client stay in sync), and
 *     spawns a ripple on a tap. Pure imperative DOM — never React state per
 *     frame (performance hard rule).
 *
 * ISOLATION: self-contained; injects/removes its own DOM. Delete with the dir.
 */
import { useEffect, useRef } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { CollabClient } from './CollabClient'
import type { ServerMsg } from './protocol'

const ACCENT = '#00E0B8'
const SEND_MS = 40 // ~25Hz — smooth, well under the cam stream's budget
const IDLE_MS = 4000 // fade the cursor out after this much stillness

export interface UseCollabCursorOpts {
  getMap: () => MaplibreMap | null | undefined
  client: CollabClient | null
  active: boolean
}

// ── presenter: sample pointer → unproject → emit `cur` ──────────────────────
export function useCollabPresenterCursor(opts: UseCollabCursorOpts): void {
  const getMapRef = useRef(opts.getMap)
  const clientRef = useRef(opts.client)
  getMapRef.current = opts.getMap
  clientRef.current = opts.client

  useEffect(() => {
    if (!opts.active) return
    let lastSent = 0
    let trailing: ReturnType<typeof setTimeout> | null = null
    let pendingEvt: { cx: number; cy: number } | null = null

    const emitFrom = (cx: number, cy: number, tap?: boolean) => {
      const map = getMapRef.current?.()
      if (!map) return
      const cont = map.getContainer()
      const r = cont.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      const px = cx - r.left
      const py = cy - r.top
      const x = px / r.width
      const y = py / r.height
      if (x < 0 || x > 1 || y < 0 || y > 1) return // off the map
      let lng: number | undefined
      let lat: number | undefined
      try {
        const ll = map.unproject([px, py])
        lng = ll.lng
        lat = ll.lat
      } catch { /* projection not ready */ }
      lastSent = Date.now()
      clientRef.current?.send({ k: 'cur', x, y, ...(lng != null ? { lng, lat } : {}), ...(tap ? { tap: true } : {}) })
    }

    const onMove = (e: PointerEvent) => {
      const dt = Date.now() - lastSent
      if (dt >= SEND_MS) {
        emitFrom(e.clientX, e.clientY)
      } else {
        pendingEvt = { cx: e.clientX, cy: e.clientY }
        if (!trailing) {
          trailing = setTimeout(() => {
            trailing = null
            if (pendingEvt) emitFrom(pendingEvt.cx, pendingEvt.cy)
            pendingEvt = null
          }, SEND_MS - dt)
        }
      }
    }
    const onDown = (e: PointerEvent) => emitFrom(e.clientX, e.clientY, true)

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      if (trailing) clearTimeout(trailing)
    }
  }, [opts.active])
}

// ── viewer: render the presenter's cursor + tap ripples ─────────────────────
export interface UseCollabRemoteCursorOpts extends UseCollabCursorOpts {
  /** presenter display name shown beside the cursor */
  label?: string
}

export function useCollabRemoteCursor(opts: UseCollabRemoteCursorOpts): void {
  const getMapRef = useRef(opts.getMap)
  const labelRef = useRef(opts.label)
  getMapRef.current = opts.getMap
  labelRef.current = opts.label

  useEffect(() => {
    if (!opts.active) return
    const client = opts.client
    if (!client) return

    let cursor: HTMLDivElement | null = null
    let nameEl: HTMLSpanElement | null = null
    let host: HTMLElement | null = null
    let raf: number | null = null
    // latest anchor: prefer geo (lng/lat), fall back to normalized (x/y).
    let anchor: { lng?: number; lat?: number; x: number; y: number } | null = null
    let lastAt = 0

    const map = () => getMapRef.current?.()

    const screenOf = (a: { lng?: number; lat?: number; x: number; y: number }): { x: number; y: number } | null => {
      const m = map()
      if (!m) return null
      const cont = m.getContainer()
      if (a.lng != null && a.lat != null) {
        try {
          const p = m.project([a.lng, a.lat])
          return { x: p.x, y: p.y }
        } catch { /* fall through to normalized */ }
      }
      return { x: a.x * cont.clientWidth, y: a.y * cont.clientHeight }
    }

    const ensureCursor = (): boolean => {
      if (cursor && host && host.isConnected) return true
      const m = map()
      if (!m) return false
      host = m.getContainer()

      const el = document.createElement('div')
      el.setAttribute('aria-hidden', 'true')
      el.style.cssText = [
        'position:absolute', 'left:0', 'top:0', 'z-index:1006',
        'pointer-events:none', 'will-change:transform',
        'transition:opacity .25s ease', 'opacity:0',
        'transform:translate3d(-100px,-100px,0)',
      ].join(';')

      const arrow = document.createElement('div')
      arrow.style.cssText = [
        'position:absolute', 'left:0', 'top:0', 'width:14px', 'height:14px',
        `background:${ACCENT}`, 'border:1.5px solid #04211c',
        'border-radius:2px 9px 9px 9px', 'transform:rotate(-90deg)',
        'box-shadow:0 2px 8px rgba(0,0,0,.45)',
      ].join(';')

      const name = document.createElement('span')
      name.textContent = labelRef.current || '经纪'
      name.style.cssText = [
        'position:absolute', 'left:16px', 'top:12px', 'white-space:nowrap',
        'font:600 11px/1 system-ui,sans-serif', 'color:#04211c',
        `background:${ACCENT}`, 'padding:3px 7px', 'border-radius:8px',
        'box-shadow:0 2px 8px rgba(0,0,0,.35)',
      ].join(';')

      el.appendChild(arrow)
      el.appendChild(name)
      host.appendChild(el)
      cursor = el
      nameEl = name
      return true
    }

    const ripple = (sx: number, sy: number) => {
      if (!host) return
      const r = document.createElement('div')
      r.setAttribute('aria-hidden', 'true')
      r.style.cssText = [
        'position:absolute', 'z-index:1005', 'pointer-events:none',
        `left:${sx.toFixed(1)}px`, `top:${sy.toFixed(1)}px`,
        'width:14px', 'height:14px', 'margin:-7px 0 0 -7px', 'border-radius:50%',
        `border:2px solid ${ACCENT}`, 'opacity:.9',
        'transform:scale(.4)', 'transition:transform .6s ease-out,opacity .6s ease-out',
      ].join(';')
      host.appendChild(r)
      requestAnimationFrame(() => { r.style.transform = 'scale(3)'; r.style.opacity = '0' })
      setTimeout(() => r.remove(), 650)
    }

    // continuous rAF: re-project the anchor every frame so the cursor tracks the
    // (moving) camera and stays glued to the same lng/lat. Fades out when idle.
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!cursor || !anchor) return
      const idle = Date.now() - lastAt > IDLE_MS
      cursor.style.opacity = idle ? '0' : '1'
      const s = screenOf(anchor)
      if (s) cursor.style.transform = `translate3d(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px,0)`
    }

    const onCur = (m: ServerMsg) => {
      if (m.k !== 'cur') return
      if (!ensureCursor()) return
      anchor = { lng: m.lng, lat: m.lat, x: m.x, y: m.y }
      lastAt = Date.now()
      if (nameEl && labelRef.current && nameEl.textContent !== labelRef.current) {
        nameEl.textContent = labelRef.current
      }
      if (m.tap) {
        const s = screenOf(anchor)
        if (s) ripple(s.x, s.y)
      }
      if (raf == null) raf = requestAnimationFrame(loop)
    }

    const off = client.on('cur', onCur)
    return () => {
      off()
      if (raf != null) cancelAnimationFrame(raf)
      cursor?.remove()
      cursor = null
      nameEl = null
      host = null
    }
  }, [opts.active, opts.client])
}
