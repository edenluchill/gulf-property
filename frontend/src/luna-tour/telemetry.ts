/**
 * Luna Tour — client behaviour telemetry (FULLY DECOUPLED, fail-safe).
 *
 * HARD RULE (see docs/luna-tour-telemetry-spec.md §0): this must NEVER affect the
 * tour. Every call is fire-and-forget — no await, no throw, no reading the
 * result. If the endpoint is down/slow/erroring, the tour is unaffected. Delete
 * this file + the TourOverlay effects + the backend event endpoint to remove the
 * feature entirely; the tour behaves identically.
 */
import { API_BASE_URL } from '../lib/config'

export type TourEvent =
  | 'open'
  | 'tour_play'
  | 'property_dwell'
  | 'chart_view'
  | 'tour_complete'
  | 'tour_replay'
  | 'cta_whatsapp'
  | 'feedback'
  | 'property_view'

interface TrackData {
  project_id?: string | null
  dwell_ms?: number
  reaction?: string
  payload?: Record<string, unknown>
}

export interface TourTelemetry {
  track: (event: TourEvent, data?: TrackData) => void
}

const VISITOR_KEY = 'lt-visitor-id'

function getVisitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id =
        (typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `v_${Math.random().toString(36).slice(2)}_${Date.now()}`)
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    // localStorage blocked (private mode etc) — degrade to a volatile id
    return `v_anon_${Math.random().toString(36).slice(2)}`
  }
}

/**
 * Build a telemetry sender bound to a share code. ALL failures are swallowed.
 */
export function createTelemetry(code: string): TourTelemetry {
  let visitorId = ''
  try {
    visitorId = getVisitorId()
  } catch {
    /* ignore */
  }
  const url = `${API_BASE_URL}/api/luna/public/v/${encodeURIComponent(code)}/event`

  const track = (event: TourEvent, data: TrackData = {}) => {
    try {
      const body = JSON.stringify({
        visitor_id: visitorId,
        event_type: event,
        project_id: data.project_id ?? undefined,
        dwell_ms: data.dwell_ms ?? undefined,
        reaction: data.reaction ?? undefined,
        payload: data.payload ?? undefined,
      })
      // Prefer sendBeacon: non-blocking, survives page unload/navigation.
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' })
        const ok = navigator.sendBeacon(url, blob)
        if (ok) return
      }
      // Fallback: keepalive fetch, fully detached, errors ignored.
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {})
    } catch {
      // Never let telemetry throw into the tour.
    }
  }

  return { track }
}
