/**
 * Luna Collaborative Tour — live cursor (presenter → viewers).
 *
 * Two hooks, one wire format (`cur` from protocol; the server already fans it
 * out verbatim, so NO backend change was needed):
 *   • useCollabPresenterCursor — samples the presenter's pointer over the map
 *     container, normalizes to 0..1, throttles to ~25Hz, and emits `cur`. A
 *     pointerdown also emits `cur{tap:true}` so a phone presenter (no hover)
 *     still shows clients "what I'm tapping".
 *   • useCollabRemoteCursor — renders the presenter's cursor as a labelled
 *     pointer that lerps smoothly toward each packet, and spawns a ripple on a
 *     tap. Pure imperative DOM in the map container — NEVER React state per
 *     frame (performance hard rule), so it adds zero re-renders.
 *
 * ISOLATION: self-contained; injects/removes its own DOM. Delete with the dir.
 */
import { useEffect, useRef } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { CollabClient } from './CollabClient'
import type { ServerMsg } from './protocol'

const ACCENT = '#00E0B8'
const SEND_MS = 40 // ~25Hz — smooth enough, well under the cam stream's budget

export interface UseCollabCursorOpts {
  getMap: () => MaplibreMap | null | undefined
  client: CollabClient | null
  active: boolean
}

/** Resolve the maplibre DOM container (where pointers + the cursor overlay live). */
function container(getMap: () => MaplibreMap | null | undefined): HTMLElement | null {
  try {
    return getMap()?.getContainer() ?? null
  } catch {
    return null
  }
}

// ── presenter: sample pointer → emit `cur` ──────────────────────────────────
export function useCollabPresenterCursor(opts: UseCollabCursorOpts): void {
  const getMapRef = useRef(opts.getMap)
  const clientRef = useRef(opts.client)
  getMapRef.current = opts.getMap
  clientRef.current = opts.client

  useEffect(() => {
    if (!opts.active) return
    let lastSent = 0
    let trailing: ReturnType<typeof setTimeout> | null = null
    let pending: { x: number; y: number } | null = null

    const norm = (e: PointerEvent): { x: number; y: number } | null => {
      const cont = container(getMapRef.current)
      if (!cont) return null
      const r = cont.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      const x = (e.clientX - r.left) / r.width
      const y = (e.clientY - r.top) / r.height
      if (x < 0 || x > 1 || y < 0 || y > 1) return null // off the map
      return { x, y }
    }

    const emit = (x: number, y: number, tap?: boolean) => {
      lastSent = Date.now()
      clientRef.current?.send({ k: 'cur', x, y, ...(tap ? { tap: true } : {}) })
    }

    const onMove = (e: PointerEvent) => {
      const p = norm(e)
      if (!p) return
      const dt = Date.now() - lastSent
      if (dt >= SEND_MS) {
        emit(p.x, p.y)
      } else {
        // throttle with a trailing send so the final resting spot still lands
        pending = p
        if (!trailing) {
          trailing = setTimeout(() => {
            trailing = null
            if (pending) emit(pending.x, pending.y)
            pending = null
          }, SEND_MS - dt)
        }
      }
    }

    const onDown = (e: PointerEvent) => {
      const p = norm(e)
      if (p) emit(p.x, p.y, true)
    }

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
  const clientRef = useRef(opts.client)
  const labelRef = useRef(opts.label)
  getMapRef.current = opts.getMap
  clientRef.current = opts.client
  labelRef.current = opts.label

  useEffect(() => {
    if (!opts.active) return

    let cursor: HTMLDivElement | null = null
    let nameEl: HTMLSpanElement | null = null
    let host: HTMLElement | null = null
    let raf: number | null = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    // normalized current + target (0..1); lerp current → target each frame.
    const cur = { x: 0.5, y: 0.5 }
    const tgt = { x: 0.5, y: 0.5 }
    let placed = false

    const ensureCursor = (): boolean => {
      if (cursor && host && host.isConnected) return true
      const cont = container(getMapRef.current)
      if (!cont) return false
      host = cont

      const el = document.createElement('div')
      el.setAttribute('aria-hidden', 'true')
      el.style.cssText = [
        'position:absolute', 'left:0', 'top:0', 'z-index:1006',
        'pointer-events:none', 'will-change:transform',
        'transition:opacity .25s ease', 'opacity:0',
        'transform:translate3d(-100px,-100px,0)',
      ].join(';')

      // arrow (rotated square caret) + name pill
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

    const px = () => {
      const cont = host
      if (!cont) return { w: 0, h: 0 }
      return { w: cont.clientWidth, h: cont.clientHeight }
    }

    const pump = () => {
      if (raf != null) return
      const tick = () => {
        if (!cursor) { raf = null; return }
        // critically-damped-ish lerp
        cur.x += (tgt.x - cur.x) * 0.25
        cur.y += (tgt.y - cur.y) * 0.25
        const { w, h } = px()
        cursor.style.transform = `translate3d(${(cur.x * w).toFixed(1)}px,${(cur.y * h).toFixed(1)}px,0)`
        const done = Math.abs(tgt.x - cur.x) < 0.0005 && Math.abs(tgt.y - cur.y) < 0.0005
        raf = done ? null : requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    const ripple = (nx: number, ny: number) => {
      if (!host) return
      const { w, h } = px()
      const r = document.createElement('div')
      r.setAttribute('aria-hidden', 'true')
      r.style.cssText = [
        'position:absolute', 'z-index:1005', 'pointer-events:none',
        `left:${(nx * w).toFixed(1)}px`, `top:${(ny * h).toFixed(1)}px`,
        'width:14px', 'height:14px', 'margin:-7px 0 0 -7px', 'border-radius:50%',
        `border:2px solid ${ACCENT}`, 'opacity:.9',
        'transform:scale(.4)', 'transition:transform .6s ease-out,opacity .6s ease-out',
      ].join(';')
      host.appendChild(r)
      requestAnimationFrame(() => {
        r.style.transform = 'scale(3)'
        r.style.opacity = '0'
      })
      setTimeout(() => r.remove(), 650)
    }

    const onCur = (m: ServerMsg) => {
      if (m.k !== 'cur') return
      if (!ensureCursor() || !cursor) return
      tgt.x = m.x
      tgt.y = m.y
      if (!placed) { cur.x = m.x; cur.y = m.y; placed = true }
      cursor.style.opacity = '1'
      if (nameEl && labelRef.current && nameEl.textContent !== labelRef.current) {
        nameEl.textContent = labelRef.current
      }
      if (m.tap) ripple(m.x, m.y)
      pump()
      // fade the cursor out if the presenter goes still for a while
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => { if (cursor) cursor.style.opacity = '0' }, 4000)
    }

    const off = clientRef.current?.on('cur', onCur)

    return () => {
      off?.()
      if (raf != null) cancelAnimationFrame(raf)
      if (idleTimer) clearTimeout(idleTimer)
      cursor?.remove()
      cursor = null
      nameEl = null
      host = null
    }
  }, [opts.active])
}
