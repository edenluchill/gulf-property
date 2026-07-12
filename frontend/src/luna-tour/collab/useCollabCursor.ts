/**
 * Luna Collaborative Tour — presenter cursor SENDER.
 *
 * Sends TWO coordinate systems on `cur`:
 *
 *   • lng/lat — the GEOGRAPHIC anchor under the pointer, whenever it's over the
 *     map. Viewers re-project it every frame so the cursor lands on the SAME
 *     BUILDING regardless of screen size/aspect. This is the one that matters:
 *     agents present on iPads, clients watch on phones, and viewport-normalized
 *     coords point at completely different places on the two devices.
 *   • x/y — viewport-normalized 0..1, the FALLBACK for when the pointer is off
 *     the map (project drawer, POI panel, toolbars). There's no geography there,
 *     but the layouts are similar enough that normalized coords still read right.
 *
 * A pointerdown also emits `cur{tap}` so a phone presenter (no hover) still shows
 * clients what they're tapping.
 *
 * The viewer-side renderer is the <CollabCursorLayer/> component.
 *
 * ISOLATION: window listeners + a getMap accessor; no React state. Delete with the dir.
 */
import { useEffect, useRef } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { CollabClient } from './CollabClient'

const SEND_MS = 40 // ~25Hz

export interface UseCollabPresenterCursorOpts {
  client: CollabClient | null
  active: boolean
  /** live map — used to geo-anchor the pointer (unproject). Optional: without it
   *  we degrade to the old viewport-normalized-only behaviour. */
  getMap?: () => MaplibreMap | null | undefined
}

export function useCollabPresenterCursor(opts: UseCollabPresenterCursorOpts): void {
  const clientRef = useRef(opts.client)
  const getMapRef = useRef(opts.getMap)
  clientRef.current = opts.client
  getMapRef.current = opts.getMap

  useEffect(() => {
    if (!opts.active) return
    let lastSent = 0
    let trailing: ReturnType<typeof setTimeout> | null = null
    let pending: { cx: number; cy: number } | null = null

    /** Geo-anchor the pointer IF it's over the map canvas; else null (off-map). */
    const geoAt = (cx: number, cy: number): { lng: number; lat: number } | null => {
      const map = getMapRef.current?.()
      const el = map?.getContainer()
      if (!map || !el) return null
      const r = el.getBoundingClientRect()
      // Pointer outside the map box (drawer / panel / toolbar) → no geography.
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null
      try {
        const ll = map.unproject([cx - r.left, cy - r.top])
        return { lng: ll.lng, lat: ll.lat }
      } catch {
        return null
      }
    }

    const emit = (cx: number, cy: number, tap?: boolean) => {
      const w = window.innerWidth || 1
      const h = window.innerHeight || 1
      lastSent = Date.now()
      const geo = geoAt(cx, cy)
      clientRef.current?.send({
        k: 'cur',
        x: cx / w, y: cy / h,          // fallback (off-map surfaces)
        ...(geo ? { lng: geo.lng, lat: geo.lat } : {}),
        ...(tap ? { tap: true } : {}),
      })
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
