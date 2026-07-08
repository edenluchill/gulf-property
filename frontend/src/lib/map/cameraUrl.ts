/**
 * 相机深链:把地图相机状态放进 URL 的 ?v= 参数,任何视角可直接分享/收藏
 * (竞品 aro.ae 的 maphash 同思路,格式取紧凑下划线分隔避免逗号被 %2C 转义)。
 *
 * 格式:v=zoom_lat_lng[_pitch_bearing]  e.g. v=12.35_25.01900_55.08900_60_-30
 * pitch/bearing 为 0 时省略,保持常见 URL 干净。
 *
 * 写入方通过 history.replaceState(不走 React Router),不触发任何重渲染;
 * 读取方只在 App 首挂载时解析一次(地图非受控,initialViewState-only)。
 */

export interface CameraView {
  longitude: number
  latitude: number
  zoom: number
  pitch?: number
  bearing?: number
}

export function serializeCameraParam(cam: {
  lng: number; lat: number; zoom: number; pitch: number; bearing: number
}): string {
  // zoom 2 位小数,经纬 5 位(~1m),pitch/bearing 取整
  const parts = [cam.zoom.toFixed(2), cam.lat.toFixed(5), cam.lng.toFixed(5)]
  const pitch = Math.round(cam.pitch)
  const bearing = Math.round(cam.bearing)
  if (pitch !== 0 || bearing !== 0) parts.push(String(pitch), String(bearing))
  return parts.join('_')
}

export function parseCameraParam(search: string): CameraView | null {
  const raw = new URLSearchParams(search).get('v')
  if (!raw) return null
  const nums = raw.split('_').map(Number)
  if (nums.length !== 3 && nums.length !== 5) return null
  if (nums.some(n => !isFinite(n))) return null
  const [zoom, lat, lng, pitch = 0, bearing = 0] = nums
  // 越界的脏参数直接忽略,回默认视角(别让恶意/坏链接把相机丢进异常状态)
  if (zoom < 3 || zoom > 20) return null
  if (lat < -85 || lat > 85 || lng < -180 || lng > 180) return null
  if (pitch < 0 || pitch > 85 || bearing < -360 || bearing > 360) return null
  return { longitude: lng, latitude: lat, zoom, pitch, bearing }
}
