/**
 * Luna Collaborative Tour — presenter sampler (§3.1).
 *
 * Every 50ms (~20Hz) it reads the live maplibre camera IMPERATIVELY (never via
 * React state — performance hard rule), and:
 *   • shouldSendCam → only emit when the camera actually moved past threshold,
 *   • classifyMove  → 'jump' (cross-district / big zoom) goes out as a reliable
 *     `goto` (viewer flyTo); 'stream' goes out as an unreliable `cam` packet,
 *   • when motion stops it sends ONE final `cam{idle:true}` and goes quiet until
 *     the camera moves again (saves bandwidth).
 *
 * ISOLATION: pure timer + math; no React state churn. Cleans up its interval on
 * unmount.
 */
import { useEffect, useRef } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { CollabClient } from './CollabClient'
import { classifyMove, shouldSendCam } from './follow-math'
import type { Cam } from './protocol'

/** Idle is declared after this many quiet ticks (≈ 200ms at 50ms cadence). */
const IDLE_TICKS = 4
const SAMPLE_MS = 50

export interface UseCollabPresenterOpts {
  getMap: () => MaplibreMap | null | undefined
  client: CollabClient | null
  /** only the presenter samples + broadcasts; viewers pass false */
  active: boolean
  sampleMs?: number
}

function readCam(map: MaplibreMap, t: number): Cam {
  const c = map.getCenter()
  // vw/vh = presenter's map viewport (css px). Viewers compensate zoom with it so
  // they see at least everything we see (iPad presenter → phone client is the
  // common case). See follow-math.zoomOffsetForViewport.
  const el = map.getContainer()
  return {
    t, c: [c.lng, c.lat], z: map.getZoom(), b: map.getBearing(), p: map.getPitch(),
    vw: el?.clientWidth || undefined,
    vh: el?.clientHeight || undefined,
  }
}

export function useCollabPresenter(opts: UseCollabPresenterOpts): void {
  const { getMap, client, active, sampleMs = SAMPLE_MS } = opts
  // Keep callbacks/values in refs so the interval is set up once and never
  // re-created mid-stream (re-creating would drop the prev-sample baseline).
  const getMapRef = useRef(getMap)
  const clientRef = useRef(client)
  getMapRef.current = getMap
  clientRef.current = client

  useEffect(() => {
    if (!active) return
    let prev: Cam | null = null
    let quietTicks = 0
    let sentIdle = false

    const id = setInterval(() => {
      const map = getMapRef.current?.()
      const c = clientRef.current
      if (!map || !c) return
      const now = readCam(map, Date.now())

      if (!shouldSendCam(prev, now)) {
        // camera at rest — emit one trailing idle frame, then stay silent.
        if (!sentIdle && prev) {
          if (++quietTicks >= IDLE_TICKS) {
            c.send({ k: 'cam', ...prev, idle: true })
            sentIdle = true
          }
        }
        return
      }

      quietTicks = 0
      sentIdle = false
      if (classifyMove(prev, now) === 'jump') {
        c.send({ k: 'goto', seq: 0, c: now.c, z: now.z, b: now.b, p: now.p, vw: now.vw, vh: now.vh })
      } else {
        c.send({ k: 'cam', ...now })
      }
      prev = now
    }, sampleMs)

    return () => clearInterval(id)
  }, [active, sampleMs])
}
