/**
 * Luna Collaborative Tour — presenter cursor SENDER.
 *
 * Broadcasts the presenter's pointer as VIEWPORT-normalized coords (0..1 of the
 * window), on `cur`. Viewport-relative (not map-relative) so the cursor can be
 * rendered by a single GLOBAL overlay that sits above EVERYTHING — the map, the
 * full-screen project drawer, POI panels — i.e. Figma-style "see what they're
 * doing" on any surface, not just the map. A pointerdown also emits `cur{tap}`
 * so a phone presenter (no hover) still shows clients what they're tapping.
 *
 * The viewer-side renderer is the <CollabCursorLayer/> component.
 *
 * ISOLATION: window listeners only; no map, no React state. Delete with the dir.
 */
import { useEffect, useRef } from 'react'
import { CollabClient } from './CollabClient'

const SEND_MS = 40 // ~25Hz

export interface UseCollabPresenterCursorOpts {
  client: CollabClient | null
  active: boolean
}

export function useCollabPresenterCursor(opts: UseCollabPresenterCursorOpts): void {
  const clientRef = useRef(opts.client)
  clientRef.current = opts.client

  useEffect(() => {
    if (!opts.active) return
    let lastSent = 0
    let trailing: ReturnType<typeof setTimeout> | null = null
    let pending: { cx: number; cy: number } | null = null

    const emit = (cx: number, cy: number, tap?: boolean) => {
      const w = window.innerWidth || 1
      const h = window.innerHeight || 1
      lastSent = Date.now()
      clientRef.current?.send({ k: 'cur', x: cx / w, y: cy / h, ...(tap ? { tap: true } : {}) })
    }

    const onMove = (e: PointerEvent) => {
      const dt = Date.now() - lastSent
      if (dt >= SEND_MS) {
        emit(e.clientX, e.clientY)
      } else {
        pending = { cx: e.clientX, cy: e.clientY }
        if (!trailing) {
          trailing = setTimeout(() => {
            trailing = null
            if (pending) emit(pending.cx, pending.cy)
            pending = null
          }, SEND_MS - dt)
        }
      }
    }
    const onDown = (e: PointerEvent) => emit(e.clientX, e.clientY, true)

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      if (trailing) clearTimeout(trailing)
    }
  }, [opts.active])
}
