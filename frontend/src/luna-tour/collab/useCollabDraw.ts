/**
 * Luna Collaborative Tour — map markup engine (pen / arrow / text / pin / circle),
 * all geo-anchored.
 *
 * Every mark is stored as lng/lat geometry and rendered through maplibre GeoJSON
 * layers, so marks PAN & ZOOM with the map (draw here, move the map, draw there —
 * the marks stay glued to the ground). Each mark is broadcast over the collab
 * `mapAction` channel (reliable + ring-replayed), so everyone in the room sees the
 * same markup and late joiners catch up.
 *
 * Mark types:
 *   • pen    — freehand polyline (drag)
 *   • arrow  — a→b line with a rotated arrowhead (drag)
 *   • text   — a typed label pinned to a point (tap → type)
 *   • pin    — an emoji marker (⭐🏫🚇…) dropped on a point (tap)
 *   • circle — a radius ring (drag out from centre); on release it looks up the
 *              area under the centre and shows median price / yield / deals
 *              ("draw-to-query" — leverages the DLD/area data the app already has).
 *
 * While a draw tool is active, single-pointer map panning is disabled so a drag
 * marks instead of panning; two-finger zoom still works. Switch to the hand tool
 * to pan. ISOLATION: owns one source + a handful of layers; cleans them up on
 * teardown. Loop-safe: remote ops update local state but are NEVER re-broadcast.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { CollabClient } from './CollabClient'
import type { ServerMsg } from './protocol'

export type DrawTool = 'none' | 'pen' | 'eraser' | 'arrow' | 'text' | 'pin' | 'circle'
export const DRAW_COLORS = ['#00E0B8', '#F43F5E', '#FBBF24', '#3B82F6', '#FFFFFF']
export const PIN_ICONS = ['⭐', '🏫', '🚇', '🏖️', '🏥', '🛒', '🍽️', '⚠️']

type LngLat = [number, number]
export type Mark =
  | { id: string; t: 'pen'; color: string; pts: LngLat[] }
  | { id: string; t: 'arrow'; color: string; pts: [LngLat, LngLat] }
  | { id: string; t: 'text'; color: string; at: LngLat; text: string }
  | { id: string; t: 'pin'; at: LngLat; icon: string }
  | { id: string; t: 'circle'; color: string; center: LngLat; radiusM: number; info?: string }

const SRC = 'lt-draw'
const L_FILL = 'lt-draw-fill'
const L_LINE = 'lt-draw-line'
const L_HEAD = 'lt-draw-arrowhead'
const L_PIN = 'lt-draw-pin'
const L_LABEL = 'lt-draw-label'
const ALL_LAYERS = [L_FILL, L_LINE, L_HEAD, L_PIN, L_LABEL]

export interface UseCollabDrawOpts {
  getMap: () => MaplibreMap | null | undefined
  client: CollabClient | null
  active: boolean
  /** circle "draw-to-query": given the circle centre, return a short multi-line
   *  string (area name + median price + yield + deals) to render at the centre,
   *  or null if no area/data is found. Supplied by the page (it owns the areas). */
  getAreaInfo?: (lng: number, lat: number) => string | null
}

export interface CollabDrawApi {
  tool: DrawTool
  setTool: (t: DrawTool) => void
  color: string
  setColor: (c: string) => void
  pinIcon: string
  setPinIcon: (i: string) => void
  clearAll: () => void
  undo: () => void
  canUndo: boolean
  hasMarks: boolean
  /** screen coords for the inline text input overlay (null = not placing text) */
  pendingText: { x: number; y: number } | null
  commitText: (text: string) => void
  cancelText: () => void
}

// ── geo helpers ──────────────────────────────────────────────────────────────
const R_EARTH = 6371000
const toR = Math.PI / 180
const toD = 180 / Math.PI

function distM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * toR
  const dLng = (b[0] - a[0]) * toR
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.sqrt(h))
}
function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin((b[0] - a[0]) * toR) * Math.cos(b[1] * toR)
  const x = Math.cos(a[1] * toR) * Math.sin(b[1] * toR) - Math.sin(a[1] * toR) * Math.cos(b[1] * toR) * Math.cos((b[0] - a[0]) * toR)
  return (Math.atan2(y, x) * toD + 360) % 360
}
function circleRing(center: LngLat, radiusM: number, steps = 64): LngLat[][] {
  const [lng, lat] = center
  const ring: LngLat[] = []
  for (let i = 0; i <= steps; i++) {
    const ang = (2 * Math.PI * i) / steps
    const dLat = ((radiusM * Math.cos(ang)) / R_EARTH) * toD
    const dLng = ((radiusM * Math.sin(ang)) / (R_EARTH * Math.cos(lat * toR))) * toD
    ring.push([lng + dLng, lat + dLat])
  }
  return [ring]
}
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`

// ── lazy map images (emoji pins + per-colour arrowheads) ─────────────────────
const emojiImgName = (e: string) => 'lt-emoji-' + Array.from(e).map((c) => c.codePointAt(0)!.toString(16)).join('-')
const headImgName = (color: string) => 'lt-head-' + color.replace('#', '')

function ensureEmojiImage(map: MaplibreMap, emoji: string) {
  const name = emojiImgName(emoji)
  if (map.hasImage(name)) return
  const px = 64
  const c = document.createElement('canvas')
  c.width = c.height = px
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.font = `${Math.floor(px * 0.72)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, px / 2, px / 2 + 2)
  const data = ctx.getImageData(0, 0, px, px)
  map.addImage(name, { width: px, height: px, data: data.data }, { pixelRatio: 2 })
}
function ensureHeadImage(map: MaplibreMap, color: string) {
  const name = headImgName(color)
  if (map.hasImage(name)) return
  const px = 40
  const c = document.createElement('canvas')
  c.width = c.height = px
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = color
  ctx.beginPath() // triangle pointing UP (north); icon-rotate spins it to bearing
  ctx.moveTo(px / 2, 3)
  ctx.lineTo(px - 5, px - 6)
  ctx.lineTo(5, px - 6)
  ctx.closePath()
  ctx.fill()
  const data = ctx.getImageData(0, 0, px, px)
  map.addImage(name, { width: px, height: px, data: data.data }, { pixelRatio: 2 })
}

export function useCollabDraw(opts: UseCollabDrawOpts): CollabDrawApi {
  const { getMap, client, active, getAreaInfo } = opts
  const [tool, setTool] = useState<DrawTool>('none')
  const [color, setColor] = useState(DRAW_COLORS[0])
  const [pinIcon, setPinIcon] = useState(PIN_ICONS[0])
  const [hasMarks, setHasMarks] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null)

  const marks = useRef<Map<string, Mark>>(new Map())
  const localOrder = useRef<string[]>([]) // ids of marks *I* added, for undo
  const pendingAt = useRef<LngLat | null>(null) // where the text input is anchored
  const toolRef = useRef(tool); toolRef.current = tool
  const colorRef = useRef(color); colorRef.current = color
  const pinIconRef = useRef(pinIcon); pinIconRef.current = pinIcon
  const getMapRef = useRef(getMap); getMapRef.current = getMap
  const clientRef = useRef(client); clientRef.current = client
  const getAreaInfoRef = useRef(getAreaInfo); getAreaInfoRef.current = getAreaInfo

  const toFC = useCallback(() => {
    const feats: GeoJSON.Feature[] = []
    for (const m of marks.current.values()) {
      if (m.t === 'pen') {
        if (m.pts.length >= 2) feats.push({ type: 'Feature', properties: { id: m.id, mt: 'pen', color: m.color }, geometry: { type: 'LineString', coordinates: m.pts } })
      } else if (m.t === 'arrow') {
        feats.push({ type: 'Feature', properties: { id: m.id, mt: 'arrowline', color: m.color }, geometry: { type: 'LineString', coordinates: m.pts } })
        feats.push({ type: 'Feature', properties: { id: m.id, mt: 'arrowhead', color: m.color, img: headImgName(m.color), rot: bearing(m.pts[0], m.pts[1]) }, geometry: { type: 'Point', coordinates: m.pts[1] } })
      } else if (m.t === 'text') {
        feats.push({ type: 'Feature', properties: { id: m.id, mt: 'text', color: m.color, label: m.text }, geometry: { type: 'Point', coordinates: m.at } })
      } else if (m.t === 'pin') {
        feats.push({ type: 'Feature', properties: { id: m.id, mt: 'pin', img: emojiImgName(m.icon) }, geometry: { type: 'Point', coordinates: m.at } })
      } else if (m.t === 'circle') {
        feats.push({ type: 'Feature', properties: { id: m.id, mt: 'circle', color: m.color }, geometry: { type: 'Polygon', coordinates: circleRing(m.center, m.radiusM) } })
        if (m.info) feats.push({ type: 'Feature', properties: { id: m.id, mt: 'circleinfo', label: m.info }, geometry: { type: 'Point', coordinates: m.center } })
      }
    }
    return { type: 'FeatureCollection' as const, features: feats }
  }, [])

  const render = useCallback(() => {
    const map = getMapRef.current?.()
    if (map && map.isStyleLoaded?.()) {
      // make sure every image a feature references exists before setData
      for (const m of marks.current.values()) {
        if (m.t === 'pin') ensureEmojiImage(map, m.icon)
        else if (m.t === 'arrow') ensureHeadImage(map, m.color)
      }
    }
    const src = map?.getSource(SRC) as { setData?: (d: unknown) => void } | undefined
    src?.setData?.(toFC())
    setHasMarks(marks.current.size > 0)
    setCanUndo(localOrder.current.length > 0)
  }, [toFC])

  const ensureLayer = useCallback((): boolean => {
    const map = getMapRef.current?.()
    if (!map || !map.isStyleLoaded?.()) return false
    if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: toFC() as never })
    if (!map.getLayer(L_FILL)) {
      map.addLayer({
        id: L_FILL, type: 'fill', source: SRC,
        filter: ['==', ['get', 'mt'], 'circle'] as never,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.1 } as never,
      } as never)
    }
    if (!map.getLayer(L_LINE)) {
      map.addLayer({
        id: L_LINE, type: 'line', source: SRC,
        filter: ['match', ['get', 'mt'], ['pen', 'arrowline', 'circle'], true, false] as never,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 5, 18, 9],
          'line-opacity': 0.95,
        } as never,
      } as never)
    }
    if (!map.getLayer(L_HEAD)) {
      map.addLayer({
        id: L_HEAD, type: 'symbol', source: SRC,
        filter: ['==', ['get', 'mt'], 'arrowhead'] as never,
        layout: {
          'icon-image': ['get', 'img'], 'icon-rotate': ['get', 'rot'],
          'icon-rotation-alignment': 'map', 'icon-size': 0.55, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        } as never,
      } as never)
    }
    if (!map.getLayer(L_PIN)) {
      map.addLayer({
        id: L_PIN, type: 'symbol', source: SRC,
        filter: ['==', ['get', 'mt'], 'pin'] as never,
        layout: {
          'icon-image': ['get', 'img'], 'icon-size': 0.6, 'icon-anchor': 'bottom',
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
        } as never,
      } as never)
    }
    if (!map.getLayer(L_LABEL)) {
      map.addLayer({
        id: L_LABEL, type: 'symbol', source: SRC,
        filter: ['match', ['get', 'mt'], ['text', 'circleinfo'], true, false] as never,
        layout: {
          'text-field': ['get', 'label'],
          // Match the area-label layer's font — the style's glyph server serves this
          // stack (incl. CJK), so Chinese annotations render instead of tofu.
          'text-font': ['Open Sans Bold'],
          'text-size': ['case', ['==', ['get', 'mt'], 'circleinfo'], 13, 16],
          'text-anchor': ['case', ['==', ['get', 'mt'], 'circleinfo'], 'top', 'center'],
          'text-offset': ['case', ['==', ['get', 'mt'], 'circleinfo'], ['literal', [0, 0.4]], ['literal', [0, 0]]],
          'text-justify': 'left', 'text-max-width': 12,
          'text-allow-overlap': true, 'text-ignore-placement': true,
        } as never,
        paint: {
          'text-color': ['case', ['==', ['get', 'mt'], 'circleinfo'], '#0f172a', ['coalesce', ['get', 'color'], '#0f172a']] as never,
          'text-halo-color': '#ffffff', 'text-halo-width': 2, 'text-halo-blur': 0.5,
        } as never,
      } as never)
    }
    return true
  }, [toFC])

  const broadcast = useCallback((action: unknown) => {
    clientRef.current?.send({ k: 'mapAction', seq: 0, action })
  }, [])

  // ── add layers once the map style is ready ─────────────────────────────────
  useEffect(() => {
    if (!active) return
    let tries = 0
    const id = setInterval(() => {
      if (ensureLayer()) { render(); clearInterval(id) }
      else if (++tries > 60) clearInterval(id)
    }, 150)
    return () => clearInterval(id)
  }, [active, ensureLayer, render])

  // ── apply remote ops (everyone, incl. the sender's peers). NEVER re-broadcast
  //    — that would ping-pong forever between two broadcasting nodes. ────────────
  useEffect(() => {
    if (!active || !client) return
    const onMsg = (m: ServerMsg) => {
      if (m.k !== 'mapAction') return
      const a = (m as { action?: { type?: string; op?: string; mark?: Mark; stroke?: Mark; id?: string } }).action
      if (!a || a.type !== '__collab_draw') return
      const mk = a.mark ?? a.stroke // `stroke` kept for backward-compat with old clients
      if (a.op === 'add' && mk) marks.current.set(mk.id, mk)
      else if (a.op === 'erase' && a.id) { marks.current.delete(a.id); localOrder.current = localOrder.current.filter((x) => x !== a.id) }
      else if (a.op === 'clear') { marks.current.clear(); localOrder.current = [] }
      ensureLayer()
      render()
    }
    const off = client.on('mapAction', onMsg)
    return () => off()
  }, [active, client, ensureLayer, render])

  // ── hydrate from the sync snapshot: what's ALREADY drawn ───────────────────
  //
  // Joining mid-tour used to land you on a clean map while the agent was saying
  // "look at the block I circled" — the draw ops that built those marks went out
  // before you connected, and ring-replay never delivers them. The server now
  // materializes marks into the sync snapshot; adopt them wholesale.
  //
  // Wholesale replace (not merge): sync IS the truth for the room we just joined.
  // Also clears any stale marks left over from a previous session in this tab.
  useEffect(() => {
    if (!active || !client) return
    const onSync = (m: ServerMsg) => {
      if (m.k !== 'sync') return
      const incoming = (m.state?.marks ?? []) as Mark[]
      marks.current.clear()
      localOrder.current = [] // they're not ours → undo must not reach back into them
      for (const mk of incoming) if (mk?.id) marks.current.set(mk.id, mk)
      ensureLayer()
      render()
    }
    const off = client.on('sync', onSync)
    return () => off()
  }, [active, client, ensureLayer, render])

  // ── pointer interactions via MAPLIBRE events (gives e.lngLat + cancels pan) ──
  useEffect(() => {
    if (!active) return
    let map: MaplibreMap | null = null
    let drawing = false
    let cur: Mark | null = null

    const commit = (m: Mark) => { marks.current.set(m.id, m); localOrder.current.push(m.id); broadcast({ type: '__collab_draw', op: 'add', mark: m }); render() }
    const cancel = () => { if (cur) marks.current.delete(cur.id); drawing = false; cur = null; render() }
    const eraseAt = (m: MaplibreMap, pt: { x: number; y: number }) => {
      const hits = m.queryRenderedFeatures([[pt.x - 12, pt.y - 12], [pt.x + 12, pt.y + 12]], { layers: ALL_LAYERS.filter((l) => m.getLayer(l)) })
      const id = hits[0]?.properties?.id as string | undefined
      if (id) { marks.current.delete(id); localOrder.current = localOrder.current.filter((x) => x !== id); broadcast({ type: '__collab_draw', op: 'erase', id }); render() }
    }

    type LL = { lng: number; lat: number }
    const begin = (m: MaplibreMap, ll: LL, pt: { x: number; y: number }, e: { preventDefault: () => void }) => {
      const t = toolRef.current
      const here: LngLat = [ll.lng, ll.lat]
      if (t === 'pen') {
        e.preventDefault(); cur = { id: uid('s'), t: 'pen', color: colorRef.current, pts: [here] }; marks.current.set(cur.id, cur); drawing = true
      } else if (t === 'arrow') {
        e.preventDefault(); cur = { id: uid('a'), t: 'arrow', color: colorRef.current, pts: [here, here] }; marks.current.set(cur.id, cur); drawing = true
      } else if (t === 'circle') {
        e.preventDefault(); cur = { id: uid('c'), t: 'circle', color: colorRef.current, center: here, radiusM: 0 }; marks.current.set(cur.id, cur); drawing = true
      } else if (t === 'pin') {
        e.preventDefault(); commit({ id: uid('p'), t: 'pin', at: here, icon: pinIconRef.current })
      } else if (t === 'text') {
        e.preventDefault(); pendingAt.current = here; setPendingText({ x: pt.x, y: pt.y })
      } else if (t === 'eraser') {
        e.preventDefault(); eraseAt(m, pt)
      }
    }
    const move = (ll: LL, e: { preventDefault: () => void }) => {
      if (!drawing || !cur) return
      e.preventDefault()
      const here: LngLat = [ll.lng, ll.lat]
      if (cur.t === 'pen') cur.pts.push(here)
      else if (cur.t === 'arrow') cur.pts[1] = here
      else if (cur.t === 'circle') cur.radiusM = distM(cur.center, here)
      render()
    }
    const finish = () => {
      if (drawing && cur) {
        if (cur.t === 'pen') { if (cur.pts.length >= 2) commit(cur); else marks.current.delete(cur.id) }
        else if (cur.t === 'arrow') { if (distM(cur.pts[0], cur.pts[1]) > 15) commit(cur); else marks.current.delete(cur.id) }
        else if (cur.t === 'circle') {
          if (cur.radiusM > 30) {
            const info = getAreaInfoRef.current?.(cur.center[0], cur.center[1])
            cur.info = info || `半径 ${(cur.radiusM / 1000).toFixed(cur.radiusM < 1000 ? 2 : 1)} km`
            commit(cur)
          } else marks.current.delete(cur.id)
        }
        render()
      }
      drawing = false; cur = null
    }

    type MEvt = { lngLat: LL; point: { x: number; y: number }; preventDefault: () => void }
    type TEvt = MEvt & { points: { x: number; y: number }[] }
    const onMouseDown = (e: MEvt) => { if (map) begin(map, e.lngLat, e.point, e) }
    const onMouseMove = (e: MEvt) => move(e.lngLat, e)
    const onMouseUp = () => finish()
    const onTouchStart = (e: TEvt) => { if (e.points.length > 1) { if (drawing) cancel(); return } if (map) begin(map, e.lngLat, e.point, e) }
    const onTouchMove = (e: TEvt) => { if (e.points.length > 1) { if (drawing) cancel(); return } move(e.lngLat, e) }
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

  // crosshair cursor while any placing tool is active (pan handled per-gesture via
  // e.preventDefault above, so dragPan stays enabled → two-finger zoom keeps working)
  useEffect(() => {
    if (!active) return
    const map = getMapRef.current?.()
    if (!map) return
    const placing = tool !== 'none'
    try { map.getCanvasContainer().style.cursor = placing ? 'crosshair' : '' } catch { /* ignore */ }
    return () => { try { map.getCanvasContainer().style.cursor = '' } catch { /* ignore */ } }
  }, [tool, active])

  const commitText = useCallback((text: string) => {
    const at = pendingAt.current
    const clean = text.trim()
    if (at && clean) {
      const m: Mark = { id: uid('t'), t: 'text', color: colorRef.current, at, text: clean }
      marks.current.set(m.id, m); localOrder.current.push(m.id)
      broadcast({ type: '__collab_draw', op: 'add', mark: m }); render()
    }
    pendingAt.current = null; setPendingText(null)
  }, [broadcast, render])

  const cancelText = useCallback(() => { pendingAt.current = null; setPendingText(null) }, [])

  const undo = useCallback(() => {
    const id = localOrder.current.pop()
    if (!id) return
    marks.current.delete(id)
    broadcast({ type: '__collab_draw', op: 'erase', id })
    render()
  }, [broadcast, render])

  const clearAll = useCallback(() => {
    marks.current.clear()
    localOrder.current = []
    broadcast({ type: '__collab_draw', op: 'clear' })
    render()
  }, [broadcast, render])

  return { tool, setTool, color, setColor, pinIcon, setPinIcon, clearAll, undo, canUndo, hasMarks, pendingText, commitText, cancelText }
}
