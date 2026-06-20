import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { type Map as MaplibreMap } from 'maplibre-gl'
import {
  Cross, GraduationCap, TrainFront, ShoppingBag, ShoppingCart,
  Utensils, Coffee, Landmark, CreditCard, TreePine, Building2,
  Hotel, Dumbbell, Umbrella, Film, Fuel, Church,
  Shield, Flame, Mail, Flag, Pill, Stethoscope, School,
  TramFront, Cable, Bus, Ship, Circle
} from 'lucide-react'

// Category-specific colors and icons
export const CATEGORY_CONFIG: Record<string, { color: string; Icon: typeof Cross }> = {
  // Healthcare - teal
  hospital: { color: '#0d9488', Icon: Cross },
  clinic: { color: '#0d9488', Icon: Stethoscope },
  pharmacy: { color: '#0d9488', Icon: Pill },
  // Education - blue
  school: { color: '#2563eb', Icon: School },
  university: { color: '#2563eb', Icon: GraduationCap },
  // Shopping - pink
  mall: { color: '#db2777', Icon: ShoppingBag },
  supermarket: { color: '#db2777', Icon: ShoppingCart },
  // Dining - amber
  restaurant: { color: '#d97706', Icon: Utensils },
  cafe: { color: '#d97706', Icon: Coffee },
  // Finance - emerald
  bank: { color: '#059669', Icon: Landmark },
  atm: { color: '#059669', Icon: CreditCard },
  // Leisure - violet
  hotel: { color: '#7c3aed', Icon: Hotel },
  park: { color: '#16a34a', Icon: TreePine },
  gym: { color: '#7c3aed', Icon: Dumbbell },
  beach: { color: '#0ea5e9', Icon: Umbrella },
  cinema: { color: '#7c3aed', Icon: Film },
  // Services - various
  gas_station: { color: '#475569', Icon: Fuel },
  mosque: { color: '#475569', Icon: Church },
  church: { color: '#475569', Icon: Church },
  police: { color: '#1e40af', Icon: Shield },
  fire_station: { color: '#dc2626', Icon: Flame },
  post_office: { color: '#475569', Icon: Mail },
  embassy: { color: '#475569', Icon: Flag },
}

// Transport line colors and icons (nicer colors than official RTA)
export const TRANSPORT_LINE_CONFIG: Record<string, { color: string; Icon: typeof Cross }> = {
  red: { color: '#ef4444', Icon: TrainFront },       // Red Line - nice red
  green: { color: '#22c55e', Icon: TrainFront },     // Green Line - nice green
  blue: { color: '#3b82f6', Icon: TrainFront },      // Blue Line - nice blue (future)
  tram: { color: '#f97316', Icon: TramFront },       // Tram - orange
  palm_monorail: { color: '#a855f7', Icon: Cable },  // Palm Monorail - purple
}

// Route type icons for custom routes (uses route's color from GeoJSON)
export const ROUTE_TYPE_CONFIG: Record<string, { defaultColor: string; Icon: typeof Cross }> = {
  metro: { defaultColor: '#ef4444', Icon: TrainFront },
  tram: { defaultColor: '#f97316', Icon: TramFront },
  bus: { defaultColor: '#22c55e', Icon: Bus },
  monorail: { defaultColor: '#a855f7', Icon: Cable },
  ferry: { defaultColor: '#0ea5e9', Icon: Ship },
  custom: { defaultColor: '#6b7280', Icon: Circle },
}


// Generate POI icon using Lucide SVG + Canvas
export async function generatePoiIcon(color: string, Icon: typeof Cross, size = 64): Promise<ImageData> {
  return new Promise((resolve) => {
    const iconSize = size * 0.55  // Bigger icon inside circle
    const offset = (size - iconSize) / 2

    // Render Lucide icon to SVG string
    const fullIconSvg = renderToStaticMarkup(
      createElement(Icon, {
        size: 24,  // Lucide native size
        stroke: '#ffffff',
        strokeWidth: 2.5,
        fill: 'none'
      })
    )
    // Extract the inner paths from the Lucide SVG (remove outer <svg> tags)
    const innerContent = fullIconSvg
      .replace(/<svg[^>]*>/, '')
      .replace(/<\/svg>/, '')
      // Ensure all paths have white stroke and no fill
      .replace(/stroke="[^"]*"/g, 'stroke="#ffffff"')
      .replace(/fill="[^"]*"/g, 'fill="none"')

    // Create full SVG with circle background + icon
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${color}" stroke="#ffffff" stroke-width="3"/>
      <g transform="translate(${offset}, ${offset})">
        <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          ${innerContent}
        </svg>
      </g>
    </svg>`

    // Convert SVG to Image
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(ctx.getImageData(0, 0, size, size))
    }
    img.onerror = (e) => {
      console.error('Failed to load POI icon:', e)
      // Fallback: simple colored circle
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.beginPath()
      ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3
      ctx.stroke()
      resolve(ctx.getImageData(0, 0, size, size))
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
  })
}

// Default config for unknown categories
export const DEFAULT_CATEGORY_CONFIG = { color: '#475569', Icon: Building2 }

// 新版 UAE 迪拉姆官方符号：D + 两道向左伸出的横线（与 DirhamSymbol.tsx 同造型）。
// 固定中性色（像 ¥/$ 一样），不随价格热力色变：深底图用白字、浅底图用深灰。
export function generateDirhamIcon(color: string, halo: string, size = 26): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.font = `700 ${size * 0.92}px Georgia, 'Times New Roman', serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = halo
  ctx.lineWidth = Math.max(3, size * 0.14)
  const dX = size * 0.56
  const dY = size * 0.85
  const barW = size * 0.58
  const barH = Math.max(2, size * 0.085)
  const bar1Y = size * 0.36
  const bar2Y = size * 0.56
  ctx.strokeText('D', dX, dY)
  ctx.strokeRect(0 + ctx.lineWidth / 2, bar1Y, barW, barH)
  ctx.strokeRect(0 + ctx.lineWidth / 2, bar2Y, barW, barH)
  ctx.fillText('D', dX, dY)
  ctx.fillRect(0 + ctx.lineWidth / 2, bar1Y, barW, barH)
  ctx.fillRect(0 + ctx.lineWidth / 2, bar2Y, barW, barH)
  return ctx.getImageData(0, 0, size, size)
}

// 1x1 透明图：没有价格的区域用它占位，地图上不会出现孤零零的货币符号
export function transparentIcon(): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  return canvas.getContext('2d')!.getImageData(0, 0, 2, 2)
}

// 生成并注入自定义图标（POI / 交通站点 / 路线）。
// 切换底图会清空 style 内的自定义 image，故需在 style.load 时重新注入。
export async function addCustomIcons(map: MaplibreMap) {
  const safeAddImage = (name: string, data: ImageData) => {
    try {
      if (!map.hasImage(name)) {
        map.addImage(name, data, { pixelRatio: 2 })
      }
    } catch {
      // Image already exists (race condition), ignore
    }
  }

  const poiIconPromises = Object.entries(CATEGORY_CONFIG).map(async ([category, config]) => {
    const imageData = await generatePoiIcon(config.color, config.Icon, 48)
    safeAddImage(`poi-${category}`, imageData)
  })
  const transportIconPromises = Object.entries(TRANSPORT_LINE_CONFIG).map(async ([line, config]) => {
    const imageData = await generatePoiIcon(config.color, config.Icon, 48)
    safeAddImage(`station-${line}`, imageData)
  })
  const routeTypeIconPromises = Object.entries(ROUTE_TYPE_CONFIG).map(async ([type, config]) => {
    const imageData = await generatePoiIcon(config.defaultColor, config.Icon, 48)
    safeAddImage(`station-${type}`, imageData)
  })

  // 迪拉姆符号：固定中性色两套（深底图用 light、浅底图用 dark）+ 空占位
  safeAddImage('dirham-light', generateDirhamIcon('#ffffff', 'rgba(0,0,0,0.85)'))
  safeAddImage('dirham-dark', generateDirhamIcon('#334155', '#ffffff'))
  safeAddImage('dirham-none', transparentIcon())

  await Promise.all([...poiIconPromises, ...transportIconPromises, ...routeTypeIconPromises])
}
