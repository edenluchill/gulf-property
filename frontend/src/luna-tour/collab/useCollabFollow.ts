/**
 * Luna Collaborative Tour — viewer follow loop + Follow/Free state machine
 * (§3.2 / §4).
 *
 * Incoming `cam` packets only update a `target`; a local rAF loop lerps the
 * actual map camera toward it via map.jumpTo() every frame (smooth even at 20Hz
 * packet rate, robust to drops). `goto` runs one cinematic flyTo. Camera frames
 * are applied IMPERATIVELY — never through React state (performance hard rule:
 * zero per-frame re-render).
 *
 * Follow/Free: while 'free' the viewer's local camera is NOT driven by remote
 * packets (targets are still tracked so returnToPresenter can snap back).
 *
 * STAGE C (not wired here): detecting the user's own gesture to flip Following→
 * Free belongs to the map component (map.on('movestart', e => e.originalEvent &&
 * setFree())). Applying the remote camera must NOT look like a user gesture —
 * jumpTo/flyTo are programmatic and carry no originalEvent, so that check stays
 * clean. `flyTo` here is a placeholder that will be wired to
 * createMapTourHandle.flyTo in Stage C.
 *
 * ISOLATION: getMap() may return null at any time → every access is guarded.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { CollabClient } from './CollabClient'
import { cameraConverged, stepCamera, type CamState } from './follow-math'
import type { Cam } from './protocol'

export type FollowMode = 'following' | 'free'

export interface FlyToArgs {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

export interface UseCollabFollowOpts {
  getMap: () => MaplibreMap | null | undefined
  client: CollabClient | null
  /** start following on join (spec default) */
  initialMode?: FollowMode
  /** Stage C wires this to createMapTourHandle.flyTo; defaults to a jumpTo. */
  flyTo?: (args: FlyToArgs) => void
}

export interface CollabFollowApi {
  mode: FollowMode
  setFree: () => void
  returnToPresenter: () => void
}

function camToState(cam: Cam): CamState {
  return { c: [cam.c[0], cam.c[1]], z: cam.z, b: cam.b, p: cam.p }
}

function readState(map: MaplibreMap): CamState {
  const c = map.getCenter()
  return { c: [c.lng, c.lat], z: map.getZoom(), b: map.getBearing(), p: map.getPitch() }
}

export function useCollabFollow(opts: UseCollabFollowOpts): CollabFollowApi {
  const { getMap, client, initialMode = 'following', flyTo } = opts
  const [mode, setMode] = useState<FollowMode>(initialMode)

  const getMapRef = useRef(getMap)
  const flyToRef = useRef(flyTo)
  getMapRef.current = getMap
  flyToRef.current = flyTo

  // mode read inside the rAF without re-binding the loop.
  const modeRef = useRef<FollowMode>(initialMode)
  modeRef.current = mode

  // latest target from cam packets + the last cam seen (for returnToPresenter).
  const targetRef = useRef<CamState | null>(null)
  const lastCamRef = useRef<Cam | null>(null)
  const rafRef = useRef<number | null>(null)

  const applyFlyTo = useCallback((args: FlyToArgs) => {
    if (flyToRef.current) {
      flyToRef.current(args)
      return
    }
    // Fallback until Stage C wires createMapTourHandle.flyTo: programmatic
    // jumpTo (no originalEvent → won't trip the gesture→Free detector).
    const map = getMapRef.current?.()
    map?.jumpTo({ center: args.center, zoom: args.zoom, bearing: args.bearing, pitch: args.pitch })
  }, [])

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const pumpRaf = useCallback(() => {
    if (rafRef.current != null) return // already running
    const tick = () => {
      const map = getMapRef.current?.()
      const target = targetRef.current
      if (!map || !target || modeRef.current !== 'following') {
        rafRef.current = null
        return
      }
      const next = stepCamera(readState(map), target)
      map.jumpTo({ center: next.c, zoom: next.z, bearing: next.b, pitch: next.p })
      if (cameraConverged(next, target)) {
        rafRef.current = null
        return // sleep until the next packet wakes us
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // subscribe to remote cam / goto.
  useEffect(() => {
    if (!client) return
    const offCam = client.on('cam', (m) => {
      if (m.k !== 'cam') return
      lastCamRef.current = m
      if (modeRef.current === 'following') {
        targetRef.current = camToState(m)
        pumpRaf()
      }
    })
    const offGoto = client.on('goto', (m) => {
      if (m.k !== 'goto') return
      const cam: Cam = { t: Date.now(), c: m.c, z: m.z, b: m.b, p: m.p }
      lastCamRef.current = cam
      targetRef.current = camToState(cam)
      if (modeRef.current === 'following') {
        stopRaf() // flyTo owns the camera for its duration
        applyFlyTo({ center: m.c, zoom: m.z, bearing: m.b, pitch: m.p })
      }
    })
    return () => {
      offCam()
      offGoto()
    }
  }, [client, pumpRaf, stopRaf, applyFlyTo])

  useEffect(() => stopRaf, [stopRaf])

  const setFree = useCallback(() => {
    stopRaf()
    setMode('free')
  }, [stopRaf])

  const returnToPresenter = useCallback(() => {
    setMode('following')
    modeRef.current = 'following'
    const cam = lastCamRef.current
    if (cam) {
      targetRef.current = camToState(cam)
      applyFlyTo({ center: cam.c, zoom: cam.z, bearing: cam.b, pitch: cam.p })
    }
  }, [applyFlyTo])

  return { mode, setFree, returnToPresenter }
}
