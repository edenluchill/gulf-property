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

  // ── local pointer drawing / erasing ───────────────────────────────────────
  useEffect(() => {
    if (!active) return
    let canvas: HTMLElement | null = null
    let drawing = false
    let cur: Stroke | null = null

    const llOf = (map: MaplibreMap, e: PointerEvent): [number, number] => {
      const r = map.getCanvasContainer().getBoundingClientRect()
      const p = map.unproject([e.clientX - r.left, e.clientY - r.top])
      return [p.lng, p.lat]
    }

    const onDown = (e: PointerEvent) => {
      const map = getMapRef.current?.()
      if (!map) return
      const t = toolRef.current
      if (t === 'pen') {
        drawing = true
        cur = {
          id: `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
          color: colorRef.current,
          pts: [llOf(map, e)],
        }
        strokes.current.set(cur.id, cur)
        try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId) } catch { /* ignore */ }
      } else if (t === 'eraser') {
        const r = map.getCanvasContainer().getBoundingClientRect()
        const x = e.clientX - r.left, y = e.clientY - r.top
        const hits = map.queryRenderedFeatures([[x - 9, y - 9], [x + 9, y + 9]], { layers: [LAYER] })
        const id = hits[0]?.properties?.id as string | undefined
        if (id) { strokes.current.delete(id); broadcast({ type: '__collab_draw', op: 'erase', id }); render() }
      }
    }
    const onMove = (e: PointerEvent) => {
      if (!drawing || !cur) return
      const map = getMapRef.current?.()
      if (!map) return
      cur.pts.push(llOf(map, e))
      render()
    }
    const onUp = () => {
      if (drawing && cur) {
        if (cur.pts.length >= 2) broadcast({ type: '__collab_draw', op: 'add', stroke: cur })
        else strokes.current.delete(cur.id)
        render()
      }
      drawing = false
      cur = null
    }

    // wait for the map's canvas, then attach
    let tries = 0
    const wire = setInterval(() => {
      const map = getMapRef.current?.()
      if (map) {
        canvas = map.getCanvasContainer()
        canvas.addEventListener('pointerdown', onDown)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        clearInterval(wire)
      } else if (++tries > 60) clearInterval(wire)
    }, 150)

    return () => {
      clearInterval(wire)
      canvas?.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [active, render, broadcast])

  // ── disable single-pointer pan while a draw tool is active ─────────────────
  useEffect(() => {
    if (!active) return
    const map = getMapRef.current?.()
    if (!map) return
    const drawingTool = tool === 'pen' || tool === 'eraser'
    try {
      if (drawingTool) { map.dragPan.disable(); map.getCanvasContainer().style.cursor = 'crosshair' }
      else { map.dragPan.enable(); map.getCanvasContainer().style.cursor = '' }
    } catch { /* ignore */ }
    return () => { try { map.dragPan.enable(); map.getCanvasContainer().style.cursor = '' } catch { /* ignore */ } }
  }, [tool, active])

  const clearAll = useCallback(() => {
    strokes.current.clear()
    broadcast({ type: '__collab_draw', op: 'clear' })
    render()
  }, [broadcast, render])

  return { tool, setTool, color, setColor, clearAll, hasStrokes }
}
