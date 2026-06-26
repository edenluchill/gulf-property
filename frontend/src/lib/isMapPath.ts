/**
 * Single source of truth for "does this route render the full-screen map?".
 *
 * The map (MapPage) is mounted ONCE and kept alive for the app's lifetime so
 * switching tabs never tears down / re-initialises the WebGL map. Both the
 * Layout (which toggles the map's visibility) and MapPage itself (which derives
 * its tour/collab code + resize trigger) must agree on which paths are "map
 * routes" — so that logic lives here.
 *
 * Map routes:
 *   /            — homepage map
 *   /map         — explicit map
 *   /v/:code     — Luna Tour shared session (runs ON the map)
 *   /t/:code     — collab co-presence viewer (runs ON the map)
 *   ?toursession — cleaner homepage tour form (/?toursession=xxx)
 */
export function isMapPath(pathname: string, search = ''): boolean {
  if (pathname === '/' || pathname === '/map') return true
  if (pathname.startsWith('/v/') || pathname.startsWith('/t/')) return true
  if (new URLSearchParams(search).has('toursession')) return true
  return false
}
