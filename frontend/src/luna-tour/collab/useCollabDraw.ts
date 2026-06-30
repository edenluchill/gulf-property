/**
 * Luna Collaborative Tour — map drawing / markup (pen + eraser), geo-anchored.
 *
 * Strokes are stored as lng/lat polylines and rendered through a maplibre GeoJSON
 * line layer, so they PAN & ZOOM with the map (draw here, move the map, draw
 * there — the marks stay glued to the ground). Each stroke is broadcast over the
 * collab `mapAction` channel (reliable + ring-replayed), so everyone in the room
 * sees the same markup and late joiners catch up.
 *
 * While a draw tool is active, single-pointer map panning is disabled so a drag
 * draws instead of panning; two-finger zoom still works. Switch back to the hand
 * tool to pan. ISOLATION: owns one source + one layer; cleans them up on teardown.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { CollabClient } from './CollabClient'
import type { ServerMsg } from './protocol'

export type DrawTool = 'none' | 'pen' | 'eraser'
export interface Stroke { id: string; color: string; pts: [number, number][] }

export const DRAW_COLORS = ['#00E0B8', '#F43F5E', '#FBBF24', '#3B82F6', '#FFFFFF']
const SRC = 'lt-draw'
const LAYER = 'lt-draw-line'

export interface UseCollabDrawOpts {
  getMap: () => MaplibreMap | null | undefined
  client: CollabClient | null
  active: boolean
}

export interface CollabDrawApi {
  tool: DrawTool
  setTool: (t: DrawTool) => void
  color: string
  setColor: (c: string) => void
  clearAll: () => void
  hasStrokes: boolean
}

export function useCollabDraw(opts: UseCollabDrawOpts): CollabDrawApi {
  const { getMap, client, active } = opts
  const [tool, setTool] = useState<DrawTool>('none')
  const [color, setColor] = useState(DRAW_COLORS[0])
  const [hasStrokes, setHasStrokes] = useState(false)

  const strokes = useRef<Map<string, Stroke>>(new Map())
  const toolRef = useRef(tool); toolRef.current = tool
  const colorRef = useRef(color); colorRef.current = color
  const getMapRef = useRef(getMap); getMapRef.current = getMap
  const clientRef = useRef(client); clientRef.current = client

  const toFC = useCallback(() => ({
    type: 'FeatureCollection' as const,
    features: Array.from(strokes.current.values())
      .filter((s) => s.pts.length >= 2)
      .map((s) => ({
        type: 'Feature' as const,
        properties: { id: s.id, color: s.color },
        geometry: { type: 'LineString' as const, coordinates: s.pts },
      })),
  }), [])

  const render = useCallback(() => {
    const map = getMapRef.current?.()
    const src = map?.getSource(SRC) as { setData?: (d: unknown) => void } | undefined
    src?.setData?.(toFC())
    setHasStrokes(strokes.current.size > 0)
  }, [toFC])

  const ensureLayer = useCallback((): boolean => {
    const map = getMapRef.current?.()
    if (!map || !map.isStyleLoaded?.()) return false
    if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: toFC() as never })
    if (!map.getLayer(LAYER)) {
      map.addLayer({
        id: LAYER,
        type: 'line',
        source: SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 5, 18, 9],
          'line-opacity': 0.95,
        },
      } as never)
    }
    return true
  }, [toFC])

  const broadcast = useCallback((action: unknown) => {
    clientRef.current?.send({ k: 'mapAction', seq: 0, action })
  }, [])

  // ── add the layer once the map style is ready ──────────────────────────────
  useEffect(() => {
    if (!active) return
    let tries = 0
    const id = setInterval(() => {
      if (ensureLayer()) { render(); clearInterval(id) }
      else if (++tries > 60) clearInterval(id)
    }, 150)
    return () => clearInterval(id)
  }, [active, ensureLayer, render])

  // ── apply remote draw ops (everyone, incl. the sender's peers) ─────────────
  useEffect(() => {
    if (!active || !client) return
    const onMsg = (m: ServerMsg) => {
      if (m.k !== 'mapAction') return
      const a = (m as { action?: { type?: string; op?: string; stroke?: Stroke; id?: string } }).action
      if (!a || a.type !== '__collab_draw') return
      if (a.op === 'add' && a.stroke) strokes.current.set(a.stroke.id, a.stroke)
      else if (a.op === 'erase' && a.id) strokes.current.delete(a.id)
      else if (a.op === 'clear') strokes.current.clear()
      ensureLayer()
      render()
    }
    const off = client.on('mapAction', onMsg)
    return () => off()
  }, [active, client, ensureLayer, render])

  // ── drawing / erasing via MAPLIBRE events (not raw DOM) ────────────────────
  // Using map.on('mousemove'/'touchmove') gives us e.lngLat directly and, crucially,
  // e.preventDefault() cancels the map's OWN pan for that gesture — so a one-finger
  // drag draws a continuous line instead of fighting the map (the "only dots" bug).
  // Touch: ONE finger draws; TWO+ fingers are left alone so pinch-zoom still works
  // (and a second finger mid-stroke aborts that stroke — no more two-finger scribble).
  useEffect(() => {
    if (!active) return
    let map: MaplibreMap | null = null
    let drawing = false
    let cur: Stroke | null = null

    const newStroke = (lng: number, lat: number): Stroke => ({
      id: `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      color: colorRef.current,
      pts: [[lng, lat]],
    })
    const cancel = () => {
      if (cur) strokes.current.delete(cur.id)
      drawing = false; cur = null; render()
    }
    const finish = () => {
      if (drawing && cur) {
        if (cur.pts.length >= 2) broadcast({ type: '__collab_draw', op: 'add', stroke: cur })
        else strokes.current.delete(cur.id)
        render()
      }
      drawing = false; cur = null
    }
    const eraseAt = (m: MaplibreMap, pt: { x: number; y: number }) => {
      const hits = m.queryRenderedFeatures([[pt.x - 10, pt.y - 10], [pt.x + 10, pt.y + 10]], { layers: [LAYER] })
      const id = hits[0]?.properties?.id as string | undefined
      if (id) { strokes.current.delete(id); broadcast({ type: '__collab_draw', op: 'erase', id }); render() }
    }

    // shared by mouse + (single-finger) touch
    type LL = { lng: number; lat: number }
    const begin = (m: MaplibreMap, ll: LL, pt: { x: number; y: number }, e: { preventDefault: () => void }) => {
      const t = toolRef.current
      if (t === 'pen') {
        e.preventDefault()
        cur = newStroke(ll.lng, ll.lat)
        strokes.current.set(cur.id, cur)
        drawing = true
      } else if (t === 'eraser') {
        e.preventDefault()
        eraseAt(m, pt)
      }
    }
    const move = (ll: LL, e: { preventDefault: () => void }) => {
      if (!drawing || !cur) return
      e.preventDefault()
      cur.pts.push([ll.lng, ll.lat])
      render()
    }

    // maplibre event shapes
    type MEvt = { lngLat: LL; point: { x: number; y: number }; preventDefault: () => void }
    type TEvt = MEvt & { points: { x: number; y: number }[] }

    const onMouseDown = (e: MEvt) => { if (map) begin(map, e.lngLat, e.point, e) }
    const onMouseMove = (e: MEvt) => move(e.lngLat, e)
    const onMouseUp = () => finish()
    const onTouchStart = (e: TEvt) => {
      if (e.points.length > 1) { if (drawing) cancel(); return } // two-finger → let map zoom
      if (map) begin(map, e.lngLat, e.point, e)
    }
    const onTouchMove = (e: TEvt) => {
      if (e.points.length > 1) { if (drawing) cancel(); return }
      move(e.lngLat, e)
    }
    const onTouchEnd = () => finish()

    let tries = 0
    const wire = setInterval(() => {
      const m = getMapRef.current?.()
      if (m) {
        map = m
        m.on('mousedown', onMouseDown as never)
        m.on('mousemove', onMouseMove as never)
        m.on('mouseup', onMouseUp as never)
        m.on('touchstart', onTouchStart as never)
        m.on('touchmove', onTouchMove as never)
        m.on('touchend', onTouchEnd as never)
        clearInterval(wire)
      } else if (++tries > 60) clearInterval(wire)
    }, 150)

    return () => {
      clearInterval(wire)
      if (map) {
        map.off('mousedown', onMouseDown as never)
        map.off('mousemove', onMouseMove as never)
        map.off('mouseup', onMouseUp as never)
        map.off('touchstart', onTouchStart as never)
        map.off('touchmove', onTouchMove as never)
        map.off('touchend', onTouchEnd as never)
      }
    }
  }, [active, render, broadcast])

  // crosshair cursor while a draw tool is active (pan is handled per-gesture via
  // e.preventDefault above, so dragPan stays enabled → two-finger zoom keeps working).
  useEffect(() => {
    if (!active) return
    const map = getMapRef.current?.()
    if (!map) return
    try { map.getCanvasContainer().style.cursor = (tool === 'pen' || tool === 'eraser') ? 'crosshair' : '' } catch { /* ignore */ }
    return () => { try { map.getCanvasContainer().style.cursor = '' } catch { /* ignore */ } }
  }, [tool, active])

  const clearAll = useCallback(() => {
    strokes.current.clear()
    broadcast({ type: '__collab_draw', op: 'clear' })
    render()
  }, [broadcast, render])

  return { tool, setTool, color, setColor, clearAll, hasStrokes }
}
