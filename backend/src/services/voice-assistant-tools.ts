/**
 * Voice Assistant Tools Definition
 *
 * These tools allow the AI to interact with the map and search properties.
 * All DB access goes through localhost API endpoints — no direct pool import.
 */

const API_BASE = `http://localhost:${process.env.PORT || 3000}`

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

// Tool definitions for Gemini Live API
export const voiceAssistantTools = [
  {
    functionDeclarations: [
      {
        name: 'search_projects',
        description: 'Search for residential projects based on criteria. Returns matching projects to display on map.',
        parameters: {
          type: 'object',
          properties: {
            area: {
              type: 'string',
              description: 'Area name in Dubai (e.g., "Dubai Marina", "Business Bay", "Downtown Dubai", "JVC")'
            },
            min_price: {
              type: 'number',
              description: 'Minimum price in AED'
            },
            max_price: {
              type: 'number',
              description: 'Maximum price in AED'
            },
            bedrooms: {
              type: 'number',
              description: 'Number of bedrooms (0 for studio)'
            },
            developer: {
              type: 'string',
              description: 'Developer name (e.g., "Emaar", "DAMAC", "Binghatti")'
            },
            near_metro: {
              type: 'boolean',
              description: 'Whether the project should be near a metro station'
            },
            status: {
              type: 'string',
              enum: ['upcoming', 'under-construction', 'completed', 'handed-over'],
              description: 'Project construction status'
            }
          }
        }
      },
      {
        name: 'fly_to_area',
        description: 'Move the map to focus on a specific Dubai area',
        parameters: {
          type: 'object',
          properties: {
            area_name: {
              type: 'string',
              description: 'Name of the area to fly to (e.g., "Dubai Marina", "Palm Jumeirah", "Downtown Dubai")'
            }
          },
          required: ['area_name']
        }
      },
      {
        name: 'get_area_info',
        description: 'Get detailed information about a Dubai area including market metrics',
        parameters: {
          type: 'object',
          properties: {
            area_name: {
              type: 'string',
              description: 'Name of the area'
            }
          },
          required: ['area_name']
        }
      },
      {
        name: 'compare_areas',
        description: 'Compare two Dubai areas for investment or living',
        parameters: {
          type: 'object',
          properties: {
            area1: {
              type: 'string',
              description: 'First area name'
            },
            area2: {
              type: 'string',
              description: 'Second area name'
            }
          },
          required: ['area1', 'area2']
        }
      },
      {
        name: 'show_nearby_pois',
        description: 'Show points of interest near the current map view',
        parameters: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['hospital', 'school', 'university', 'mall', 'supermarket', 'metro_station', 'restaurant', 'park', 'beach', 'gym'],
              description: 'Category of POIs to show'
            },
            radius_meters: {
              type: 'number',
              description: 'Search radius in meters (default 2000)'
            }
          },
          required: ['category']
        }
      },
      {
        name: 'show_transport',
        description: 'Show transport lines on the map (metro, tram)',
        parameters: {
          type: 'object',
          properties: {
            show: {
              type: 'boolean',
              description: 'Whether to show transport layer'
            }
          },
          required: ['show']
        }
      },
      {
        name: 'highlight_projects',
        description: 'Highlight specific projects on the map',
        parameters: {
          type: 'object',
          properties: {
            project_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of project IDs to highlight'
            }
          },
          required: ['project_ids']
        }
      },
      {
        name: 'open_project_detail',
        description: 'Navigate to a project detail page',
        parameters: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Project ID to open'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'add_to_favorites',
        description: 'Add a project to user favorites',
        parameters: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Project ID to add to favorites'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'reset_map',
        description: 'Reset map to default view, clear all filters and highlights',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'navigate_to_project',
        description: 'Navigate to a project detail page for more information',
        parameters: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project ID to navigate to'
            },
            project_name: {
              type: 'string',
              description: 'The project name (for confirmation)'
            }
          },
          required: ['project_id']
        }
      },
      {
        name: 'measure_distance',
        description: 'Measure the straight-line distance between two places on the map (areas, landmarks, or projects). Draws the line on the map and tells the distance in km.',
        parameters: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              description: 'Start place name, e.g. an area or landmark like "Dubai Marina" or "Burj Khalifa"'
            },
            to: {
              type: 'string',
              description: 'End place name, e.g. "Downtown Dubai", "Dubai International Airport"'
            }
          },
          required: ['from', 'to']
        }
      },
      {
        name: 'analyze_area_amenities',
        description: 'Analyze how convenient a Dubai area is by measuring straight-line distance from the area to its NEAREST hospital, school, shopping mall, metro station and supermarket. Draws labeled distance spokes on the map and returns a 0-100 convenience score with a tier. Use this whenever the customer asks how good/convenient/livable a location is, whether amenities are close, or "how far is the nearest school/hospital/metro".',
        parameters: {
          type: 'object',
          properties: {
            area_name: {
              type: 'string',
              description: 'The Dubai area to analyze, e.g. "Dubai Marina", "JVC", "Business Bay"'
            }
          },
          required: ['area_name']
        }
      }
    ]
  }
]

// 两点球面距离（km）
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Map tool name to execution function
export async function executeTool(
  toolName: string,
  params: any
): Promise<{ result: any; summary: string; mapAction?: any }> {
  switch (toolName) {
    case 'search_projects': {
      const qs = new URLSearchParams()
      if (params.area) qs.set('area', params.area)
      if (params.min_price) qs.set('min_price', String(params.min_price))
      if (params.max_price) qs.set('max_price', String(params.max_price))
      if (params.bedrooms !== undefined) qs.set('bedrooms', String(params.bedrooms))
      if (params.developer) qs.set('developer', params.developer)
      if (params.status) qs.set('status', params.status)

      const data = await apiFetch<{ projects: any[]; count: number; summary: string }>(
        `/api/ai/projects/search?${qs.toString()}`
      )

      // Compute bounding box for multi-project results
      const validCoords = data.projects.filter(p => p.latitude && p.longitude)
      const mapAction: any = {
        type: 'highlight_projects',
        projectIds: data.projects.map(p => p.id)
      }
      if (validCoords.length > 1) {
        const lats = validCoords.map(p => parseFloat(p.latitude))
        const lngs = validCoords.map(p => parseFloat(p.longitude))
        mapAction.bounds = {
          sw: [Math.min(...lngs), Math.min(...lats)],
          ne: [Math.max(...lngs), Math.max(...lats)]
        }
      } else if (validCoords.length === 1) {
        mapAction.lat = validCoords[0].latitude
        mapAction.lng = validCoords[0].longitude
        mapAction.zoom = 11
      }

      return {
        result: { projects: data.projects, count: data.count },
        summary: data.summary,
        mapAction
      }
    }

    case 'fly_to_area': {
      const data = await apiFetch<{ area: { id: number; name: string; lat: number; lng: number } | null }>(
        `/api/ai/areas/match?q=${encodeURIComponent(params.area_name)}`
      )

      if (data.area) {
        return {
          result: { area: data.area.name, lat: data.area.lat, lng: data.area.lng },
          summary: `Flying to ${data.area.name}.`,
          mapAction: {
            type: 'fly_to',
            lat: data.area.lat,
            lng: data.area.lng,
            zoom: 11
          }
        }
      }
      return {
        result: null,
        summary: `Could not find area ${params.area_name}.`
      }
    }

    case 'get_area_info': {
      const data = await apiFetch<{
        area: any; metrics: any; nearby_benchmarks: any[]; investment_5yr: any; centroid: { lat: number; lng: number } | null; summary: string
      }>(`/api/ai/areas/info?name=${encodeURIComponent(params.area_name)}`)

      let mapAction: any = undefined
      if (data.centroid) {
        mapAction = { type: 'show_area_info', lat: data.centroid.lat, lng: data.centroid.lng, zoom: 11 }
      }

      return {
        result: { area: data.area, metrics: data.metrics, nearby_benchmarks: data.nearby_benchmarks, investment_5yr: data.investment_5yr },
        summary: data.summary,
        mapAction
      }
    }

    case 'compare_areas': {
      const data = await apiFetch<{ comparison: any; summary: string }>(
        `/api/ai/areas/compare?area1=${encodeURIComponent(params.area1)}&area2=${encodeURIComponent(params.area2)}`
      )

      return {
        result: data.comparison,
        summary: data.summary,
        mapAction: data.comparison ? {
          type: 'highlight_areas',
          areas: [params.area1, params.area2]
        } : undefined
      }
    }

    case 'navigate_to_project': {
      const data = await apiFetch<{ result: any; summary: string }>(
        `/api/ai/projects/${encodeURIComponent(params.project_id)}/detail`
      )

      if (data.result) {
        return {
          result: data.result,
          summary: data.summary,
          mapAction: data.result.latitude && data.result.longitude
            ? { type: 'fly_to', lat: data.result.latitude, lng: data.result.longitude, zoom: 11 }
            : { type: 'navigate', path: `/project/${params.project_id}` }
        }
      }
      return {
        result: null,
        summary: data.summary || `Could not find project ${params.project_name || params.project_id}.`
      }
    }

    // --- Pure frontend actions (no DB needed) ---

    case 'show_nearby_pois': {
      return {
        result: { category: params.category, radius: params.radius_meters || 2000 },
        summary: `Showing ${params.category}s on the map.`,
        mapAction: {
          type: 'show_pois',
          category: params.category,
          radius: params.radius_meters || 2000
        }
      }
    }

    case 'show_transport': {
      return {
        result: { show: params.show },
        summary: params.show ? 'Showing metro and tram lines.' : 'Hiding transport layer.',
        mapAction: {
          type: 'toggle_transport',
          show: params.show
        }
      }
    }

    case 'highlight_projects': {
      return {
        result: { projectIds: params.project_ids },
        summary: `Highlighting ${params.project_ids.length} project(s) on the map.`,
        mapAction: {
          type: 'highlight_projects',
          projectIds: params.project_ids
        }
      }
    }

    case 'open_project_detail': {
      return {
        result: { projectId: params.project_id },
        summary: 'Opening project details.',
        mapAction: {
          type: 'navigate',
          path: `/project/${params.project_id}`
        }
      }
    }

    case 'add_to_favorites': {
      return {
        result: { projectId: params.project_id },
        summary: 'Added to your favorites.',
        mapAction: {
          type: 'add_favorite',
          projectId: params.project_id
        }
      }
    }

    case 'reset_map': {
      return {
        result: {},
        summary: 'Map reset to default view.',
        mapAction: {
          type: 'reset'
        }
      }
    }

    case 'measure_distance': {
      const resolve = async (q: string) => {
        const d = await apiFetch<{ area: { name: string; lat: number; lng: number } | null }>(
          `/api/ai/areas/match?q=${encodeURIComponent(q)}`
        )
        return d.area
      }
      const [a, b] = await Promise.all([resolve(params.from), resolve(params.to)])

      if (!a || !b) {
        const missing = !a ? params.from : params.to
        return {
          result: null,
          summary: `I couldn't locate "${missing}" on the map, so I can't measure that distance yet.`
        }
      }

      const km = haversineKm(a, b)
      const dist = km < 1 ? `${Math.round(km * 1000)} meters` : `${km.toFixed(1)} km`
      return {
        result: { from: a.name, to: b.name, distance_km: Number(km.toFixed(2)) },
        summary: `${a.name} to ${b.name} is about ${dist} in a straight line.`,
        mapAction: {
          type: 'measure_distance',
          points: [[a.lng, a.lat], [b.lng, b.lat]],
          distanceKm: Number(km.toFixed(2)),
          fromName: a.name,
          toName: b.name
        }
      }
    }

    case 'analyze_area_amenities': {
      const d = await apiFetch<{ area: { name: string; lat: number; lng: number } | null }>(
        `/api/ai/areas/match?q=${encodeURIComponent(params.area_name)}`
      )
      const area = d.area
      if (!area) {
        return {
          result: null,
          summary: `我在地图上没找到 "${params.area_name}" 这个区域，换个区域名我再帮你看周边配套。`
        }
      }

      // 每类配套：中文名 + 评分参数（理想距离内满分，到 zero 公里降为 0）+ 权重
      const SPECS = [
        { cat: 'hospital',      zh: '医院', emoji: '🏥', ideal: 2,   zero: 10, weight: 0.20 },
        { cat: 'school',        zh: '学校', emoji: '🏫', ideal: 1.5, zero: 6,  weight: 0.20 },
        { cat: 'mall',          zh: '商场', emoji: '🛍️', ideal: 3,   zero: 8,  weight: 0.20 },
        { cat: 'metro_station', zh: '地铁', emoji: '🚇', ideal: 1.5, zero: 5,  weight: 0.25 },
        { cat: 'supermarket',   zh: '超市', emoji: '🛒', ideal: 1,   zero: 4,  weight: 0.15 },
      ] as const

      const near = await apiFetch<{ pois: { name: string; category: string; lat: number; lng: number; distance_meters: number }[] }>(
        `/api/dubai-pois/near?lat=${area.lat}&lng=${area.lng}&radius=10000&categories=${SPECS.map(s => s.cat).join(',')}`
      )
      const pois = near.pois || []

      const spokes: { category: string; label: string; emoji: string; name: string; lng: number; lat: number; distanceKm: number }[] = []
      let score = 0
      for (const s of SPECS) {
        const hit = pois.filter(p => p.category === s.cat)
          .sort((a, b) => a.distance_meters - b.distance_meters)[0]
        if (!hit) continue
        const km = hit.distance_meters / 1000
        const sub = Math.max(0, Math.min(1, (s.zero - km) / (s.zero - s.ideal)))
        score += s.weight * sub
        spokes.push({
          category: s.cat, label: s.zh, emoji: s.emoji, name: hit.name,
          lng: hit.lng, lat: hit.lat, distanceKm: Number(km.toFixed(2))
        })
      }

      if (spokes.length === 0) {
        return {
          result: { area: area.name, score: 0, amenities: [] },
          summary: `${area.name} 周边 10 公里内暂时没有收录到医院/学校/商场/地铁/超市的数据，配套信息有限。`
        }
      }

      const score100 = Math.round(score * 100)
      const tier = score100 >= 75 ? '优秀'
        : score100 >= 55 ? '良好'
        : score100 >= 35 ? '一般'
        : '偏远'
      const list = spokes.map(s => `${s.label} ${s.distanceKm}km`).join('、')

      return {
        result: {
          area: area.name,
          convenience_score: score100,
          tier,
          amenities: spokes.map(s => ({ type: s.label, name: s.name, distance_km: s.distanceKm }))
        },
        summary: `${area.name} 生活便利度 ${score100}/100（${tier}）。最近：${list}。`,
        mapAction: {
          type: 'amenity_spokes',
          center: [area.lng, area.lat],
          centerName: area.name,
          score: score100,
          tier,
          spokes
        }
      }
    }

    default:
      return {
        result: null,
        summary: `Unknown tool: ${toolName}`
      }
  }
}
