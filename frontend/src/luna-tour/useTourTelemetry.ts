/**
 * Luna Tour — telemetry observers (decoupled hook).
 *
 * Watches the engine snapshot and emits behaviour events. FULLY DECOUPLED: it
 * only READS the snapshot (never touches the engine) and fires fire-and-forget
 * telemetry. Returns the `tel` instance so the host can emit manual events
 * (feedback / cta / property_view / ask). Delete this file + its use in
 * TourOverlay to remove all behaviour analytics; the tour is unaffected.
 */
import { useEffect, useRef } from 'react'
import { createTelemetry, type TourTelemetry } from './telemetry'
import type { EngineSnapshot } from './engine/TimelineEngine'
import type { WatchPayload } from './types'

export function useTourTelemetry(
  code: string,
  data: WatchPayload | null,
  snap: EngineSnapshot | null
): TourTelemetry {
  const telRef = useRef<TourTelemetry | null>(null)
  if (!telRef.current) telRef.current = createTelemetry(code)
  const tel = telRef.current

  // resolve project_id + beat kind for an act segment
  const resolveSeg = (segmentKey: string, actIndex: number) => {
    if (!data || actIndex < 0) return { projectId: null as string | null, kind: undefined as string | undefined }
    const act = data.script.acts[actIndex]
    if (!act) return { projectId: null as string | null, kind: undefined as string | undefined }
    const beat = act.beats.find((bb) => `a${actIndex}-${bb.id}` === segmentKey)
    return { projectId: act.property_id, kind: beat?.kind }
  }

  // open (once the session is loaded)
  const openedRef = useRef(false)
  useEffect(() => {
    if (data && !openedRef.current) {
      openedRef.current = true
      tel.track('open')
    }
  }, [data, tel])

  // per-beat dwell + chart_view (fires as playback crosses beats)
  const lastSegRef = useRef<{ key: string; projectId: string | null; enterTs: number } | null>(null)
  useEffect(() => {
    const key = snap?.segmentKey
    if (!key) return
    const now = performance.now()
    const prev = lastSegRef.current
    if (prev && prev.key !== key && prev.projectId) {
      tel.track('property_dwell', { project_id: prev.projectId, dwell_ms: now - prev.enterTs })
    }
    if (!prev || prev.key !== key) {
      const { projectId, kind } = resolveSeg(key, snap?.actIndex ?? -1)
      lastSegRef.current = { key, projectId, enterTs: now }
      if (kind === 'numbers' && projectId) tel.track('chart_view', { project_id: projectId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.segmentKey])

  // tour_complete (once, on reaching the end)
  const prevStateRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const st = snap?.state
    if (st === 'ended' && prevStateRef.current !== 'ended') tel.track('tour_complete')
    prevStateRef.current = st
  }, [snap?.state, tel])

  return tel
}
