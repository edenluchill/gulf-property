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
        description: 'Show (or hide) a category of points-of-interest on the map as labeled markers. The customer can also toggle these same categories from the map filter, so this drives the SAME filter the user sees. Use when asked to "show the schools / hospitals / malls / parks nearby", or "hide the restaurants". To hide a category, pass hide=true.',
        parameters: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: [
                'hospital', 'clinic', 'pharmacy', 'school', 'university', 'mall', 'supermarket',
                'restaurant', 'cafe', 'bank', 'atm', 'gas_station', 'hotel', 'mosque', 'church',
                'park', 'gym', 'beach', 'cinema', 'police', 'fire_station', 'post_office', 'embassy'
              ],
              description: 'Category of POIs to show/hide on the map'
            },
            hide: {
              type: 'boolean',
              description: 'Set true to HIDE this category instead of showing it (default false = show)'
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
        description: 'Draw distances ON the map as spokes radiating from ONE center place to several destinations — each line labeled with its distance. The FIRST item in "places" is the center; every other item gets its own line+distance from that center. Great for "how far is <project/area> from the metro, the mall, the airport, the beach". Use from/to for a simple two-point measure (from = center).',
        parameters: {
          type: 'object',
          properties: {
            places: {
              type: 'array',
              items: { type: 'string' },
              description: 'First element = the CENTER/anchor place; remaining elements = destinations measured from it. e.g. ["Emaar Beachfront","Dubai Mall","DXB Airport","JBR Beach"] draws 3 distance lines out from Emaar Beachfront.'
            },
            from: {
              type: 'string',
              description: 'Center place name (use for a simple two-point measure). E.g. "Dubai Marina"'
            },
            to: {
              type: 'string',
              description: 'Single destination (use for a simple two-point measure). E.g. "Downtown Dubai"'
            }
          }
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
      },
      {
        name: 'recommend_by_budget',
        description: 'Recommend the best Dubai areas to buy given a budget. Use when the customer states a budget/income and an intent. Returns areas within budget ranked by goal, each with median price, gross rental yield %, 3-year price growth %, and confidence. Based on real DLD transaction + rental data.',
        parameters: {
          type: 'object',
          properties: {
            budget: { type: 'number', description: 'Budget in AED (total purchase price the customer can afford)' },
            goal: { type: 'string', enum: ['yield', 'growth', 'balanced'], description: 'yield=rental income; growth=capital appreciation; balanced=both. Default balanced.' },
            property_type: { type: 'string', enum: ['apartment', 'villa', 'townhouse'], description: 'Default apartment' },
            bedrooms: { type: 'number', description: 'Bedrooms (0=studio). Omit for any.' }
          },
          required: ['budget']
        }
      },
      {
        name: 'get_investment_breakdown',
        description: 'Investment analysis for a specific area + property type + bedrooms: median price, gross rental yield %, 3-year CAGR, and an INDICATIVE 5-year ROI projection with payback years. Use when the customer asks the ROI/yield/return for a specific area & unit type (e.g. "a 1-bed in Business Bay"). More granular than get_area_info. Always relay the confidence; call projections indicative, never guaranteed.',
        parameters: {
          type: 'object',
          properties: {
            area: { type: 'string', description: 'Dubai area name, e.g. "Business Bay", "Dubai Marina", "JVC"' },
            property_type: { type: 'string', enum: ['apartment', 'villa', 'townhouse'], description: 'Default apartment' },
            bedrooms: { type: 'number', description: 'Bedrooms (0=studio). Omit for any.' },
            offplan: { type: 'boolean', description: 'true=off-plan only, false=ready only, omit=both' }
          },
          required: ['area']
        }
      },
      {
        name: 'compare_market',
        description: 'Controlled comparison over real DLD sales: hold conditions constant and vary ONE dimension to isolate its effect on price. Use for "is off-plan pricier than ready here?" (vary=is_offplan), "how does price change by bedroom?" (vary=bedrooms), "which areas are priciest?" (vary=area_name). Returns each group with transaction count + median price.',
        parameters: {
          type: 'object',
          properties: {
            vary: { type: 'string', enum: ['is_offplan', 'bedrooms', 'area_name', 'ptype', 'size_band', 'year'], description: 'The single dimension to break results down by (the variable being compared)' },
            property_type: { type: 'string', enum: ['apartment', 'villa', 'townhouse'], description: 'Hold property type constant' },
            bedrooms: { type: 'number', description: 'Hold bedrooms constant (0=studio)' },
            area: { type: 'string', description: 'Restrict to an area (fuzzy), e.g. "Marina"' }
          },
          required: ['vary']
        }
      },
      {
        name: 'area_investment_report',
        description: 'Full investment report for an area + property type + bedrooms in ONE call: price level & range, 3-year & YoY growth, gross rental yield, indicative 5-year ROI & payback, liquidity, price vs city average, off-plan share, confidence, and an explicit list of data gaps. Use this as the DEFAULT for any "analyze / is it a good investment / give me the numbers" question — it is the most complete. Relay confidence and gaps honestly; projections are indicative.',
        parameters: {
          type: 'object',
          properties: {
            area: { type: 'string', description: 'Dubai area, e.g. "Business Bay", "Dubai Marina", "JVC"' },
            property_type: { type: 'string', enum: ['apartment', 'villa', 'townhouse'], description: 'Default apartment' },
            bedrooms: { type: 'number', description: 'Bedrooms: 0=studio, 1, 2… Omit for any.' }
          },
          required: ['area']
        }
      },
      {
        name: 'check_affordability',
        description: 'Work out what the customer can afford from their monthly income OR cash for down-payment, then recommend areas within that budget. Use when the customer gives an income/salary or savings and asks what/where they can buy. Returns max purchase price, required down payment, monthly mortgage, and affordable areas with yield & growth.',
        parameters: {
          type: 'object',
          properties: {
            income: { type: 'number', description: 'Monthly income in AED (for mortgage capacity)' },
            cash: { type: 'number', description: 'Cash available for down payment in AED' },
            property_type: { type: 'string', enum: ['apartment', 'villa', 'townhouse'], description: 'Default apartment' },
            bedrooms: { type: 'number', description: 'Bedrooms: 0=studio, 1, 2…' }
          }
        }
      },
      {
        name: 'project_value_check',
        description: 'Check whether a specific project\'s asking price is above or below the DLD resale median for its area & bedroom count. Use when the customer asks "is this project fairly priced / a good deal / pricier than the area". Needs project_id (from search results).',
        parameters: {
          type: 'object',
          properties: { project_id: { type: 'string', description: 'Project ID from search results' } },
          required: ['project_id']
        }
      },
      {
        name: 'purchase_costs',
        description: 'Break down the one-time purchase costs of buying in Dubai (DLD 4% transfer, agent 2%, admin/trustee, mortgage registration) and the all-in total. Use when the customer asks "what fees / total cost / how much extra to buy".',
        parameters: {
          type: 'object',
          properties: {
            price: { type: 'number', description: 'Property price in AED' },
            mortgage: { type: 'boolean', description: 'true if buying with a mortgage (adds registration fee)' }
          },
          required: ['price']
        }
      },
      {
        name: 'rent_vs_buy',
        description: 'Indicative rent-vs-buy comparison for an area/unit over N years (buying net cost incl. appreciation vs total rent paid). Use when the customer asks "should I rent or buy". Note: ignores mortgage interest & service charges (data gaps) — say so.',
        parameters: {
          type: 'object',
          properties: {
            area: { type: 'string', description: 'Dubai area' },
            property_type: { type: 'string', enum: ['apartment', 'villa', 'townhouse'], description: 'Default apartment' },
            bedrooms: { type: 'number', description: 'Bedrooms (0=studio)' },
            years: { type: 'number', description: 'Holding horizon in years (default 5)' }
          },
          required: ['area']
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
      const hide = params.hide === true
      return {
        result: { category: params.category, hide, radius: params.radius_meters || 2000 },
        summary: hide ? `Hiding ${params.category}s on the map.` : `Showing ${params.category}s on the map.`,
        mapAction: {
          type: 'show_pois',
          category: params.category,
          hide,
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
      // 支持多点路径(places)或两点(from/to)
      const names: string[] = Array.isArray(params.places) && params.places.length >= 2
        ? params.places
        : [params.from, params.to].filter(Boolean)

      if (names.length < 2) {
        return { result: null, summary: '我需要至少两个地点才能在地图上画出距离。' }
      }

      const resolved = await Promise.all(names.map(resolve))
      const missingIdx = resolved.findIndex(r => !r)
      if (missingIdx >= 0) {
        return {
          result: null,
          summary: `我在地图上没找到 "${names[missingIdx]}",换个地点名我再帮你测。`
        }
      }
      const pts = resolved as { name: string; lat: number; lng: number }[]

      // 放射:第一个地点=中心,其余每个各自到中心一条线
      const hub = pts[0]
      const spokes = pts.slice(1).map(p => ({
        to: p.name, km: Number(haversineKm(hub, p).toFixed(2))
      }))
      const fmt = (km: number) => (km < 1 ? `${Math.round(km * 1000)} 米` : `${km.toFixed(1)} 公里`)
      const spokeText = spokes.map(s => `到${s.to} ${fmt(s.km)}`).join(',')
      const summary = spokes.length === 1
        ? `${hub.name} 到 ${spokes[0].to} 直线约 ${fmt(spokes[0].km)}。`
        : `已在地图上从 ${hub.name} 画出到各地点的距离:${spokeText}。`

      return {
        result: {
          center: hub.name,
          distances: spokes.map(s => ({ to: s.to, distance_km: s.km }))
        },
        summary,
        mapAction: {
          type: 'measure_distance',
          points: pts.map(p => [p.lng, p.lat]),
          fromName: hub.name,
          toName: spokes.map(s => s.to).join(', ')
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

    case 'recommend_by_budget': {
      const qs = new URLSearchParams()
      qs.set('budget', String(params.budget))
      if (params.goal) qs.set('goal', params.goal)
      if (params.property_type) qs.set('property_type', params.property_type)
      if (params.bedrooms !== undefined) qs.set('bedrooms', String(params.bedrooms))
      const data = await apiFetch<{ results: any[] }>(`/api/ai/analytics/recommend?${qs.toString()}`)
      const rows = data.results || []
      if (!rows.length) {
        return { result: { areas: [] }, summary: `预算 ${Math.round(params.budget / 1000)}万 AED 内暂时没有足够数据的区域,可以放宽预算或换户型。` }
      }
      const top = rows.slice(0, 3).map((r: any) =>
        `${r.area_name}(中位约 ${Math.round(r.median_price_aed / 1000)}万,毛收益 ${r.gross_yield_pct ?? '—'}%,3年涨 ${r.cagr_3y_pct ?? '—'}%)`
      ).join(';')
      return {
        result: { areas: rows },
        summary: `预算 ${Math.round(params.budget / 1000)}万内,按${params.goal || '综合'}推荐:${top}。(基于真实成交,指示性参考)`,
        mapAction: { type: 'highlight_areas', areas: rows.map((r: any) => r.area_name) }
      }
    }

    case 'get_investment_breakdown': {
      const qs = new URLSearchParams()
      qs.set('area', params.area)
      if (params.property_type) qs.set('property_type', params.property_type)
      if (params.bedrooms !== undefined) qs.set('bedrooms', String(params.bedrooms))
      if (params.offplan !== undefined) qs.set('offplan', String(params.offplan))
      const d = await apiFetch<any>(`/api/ai/analytics/investment?${qs.toString()}`)
      if (d.error || !d.median_price_aed) {
        return { result: d, summary: `${params.area} 这个条件样本有限,暂时给不出可靠的投资分析。` }
      }
      const p = d.projection_5y || {}
      return {
        result: d,
        summary: `${d.area} ${d.bedrooms ?? ''}居${d.ptype}:中位价约 ${Math.round(d.median_price_aed / 1000)}万 AED,毛租金收益 ${d.gross_yield_pct ?? '—'}%,近3年年化 ${d.cagr_3y_pct ?? '—'}%。指示性5年总回报约 ${p.total_roi_pct ?? '—'}%,回本约 ${p.payback_years ?? '—'} 年(样本置信度 ${d.sample?.confidence};指示性,非保证)。`
      }
    }

    case 'compare_market': {
      const qs = new URLSearchParams()
      qs.set('vary', params.vary)
      if (params.property_type) qs.set('property_type', params.property_type)
      if (params.bedrooms !== undefined) qs.set('bedrooms', String(params.bedrooms))
      if (params.area) qs.set('area', params.area)
      const data = await apiFetch<{ results: any[] }>(`/api/ai/analytics/compare?${qs.toString()}`)
      const rows = data.results || []
      if (!rows.length) return { result: { groups: [] }, summary: '这个对比条件下暂时没有足够数据。' }
      const label = (r: any) => r[params.vary] === true ? '期房' : r[params.vary] === false ? '现房' : String(r[params.vary])
      const parts = rows.slice(0, 8).map((r: any) =>
        `${label(r)}:${r.median_price_sqm ? Math.round(r.median_price_sqm) + ' AED/㎡' : '—'}(${r.txn_count}笔)`
      ).join(';')
      return { result: { groups: rows }, summary: `按 ${params.vary} 对比(其余固定):${parts}。` }
    }

    case 'area_investment_report': {
      const qs = new URLSearchParams()
      qs.set('area', params.area)
      if (params.property_type) qs.set('property_type', params.property_type)
      if (params.bedrooms !== undefined) qs.set('bedrooms', String(params.bedrooms))
      const d = await apiFetch<any>(`/api/ai/analytics/report?${qs.toString()}`)
      if (d.error) return { result: d, summary: `${params.area} 这个条件近2年没足够成交,给不出可靠报告。` }
      const pr = d.pricing, t = d.trend, y = d.yield, p = d.projection_5y, c = d.context
      const vsCity = c.vs_city_pct >= 0 ? `高${c.vs_city_pct}%` : `低${Math.abs(c.vs_city_pct)}%`
      return {
        result: d,
        summary: `${d.area} ${d.bedrooms ?? ''}居${d.ptype}:中位 ${Math.round(pr.median_price_aed / 1000)}万 AED(${pr.median_price_sqm}/㎡,比全城${vsCity}),近3年年化 ${t.cagr_3y_pct}%、同比 ${t.yoy_pct}%(${t.direction}),毛收益 ${y.gross_yield_pct ?? '—'}%,指示性5年ROI ${p.total_roi_pct}%、回本 ${p.payback_years ?? '—'}年,流动性${d.liquidity.level}(置信度${d.sample.confidence})。净收益/供给/人口数据暂缺。`
      }
    }

    case 'check_affordability': {
      const qs = new URLSearchParams()
      if (params.income) qs.set('income', String(params.income))
      if (params.cash) qs.set('cash', String(params.cash))
      if (params.property_type) qs.set('property_type', params.property_type)
      if (params.bedrooms !== undefined) qs.set('bedrooms', String(params.bedrooms))
      const d = await apiFetch<any>(`/api/ai/analytics/affordability?${qs.toString()}`)
      const areas = (d.affordable_areas || []).slice(0, 3)
        .map((a: any) => `${a.area_name}(中位${Math.round(a.median_price_aed / 1000)}万,收益${a.gross_yield_pct ?? '—'}%)`).join(';')
      return {
        result: d,
        summary: `按你的条件大约能买到 ${Math.round(d.max_price_aed / 1000)}万 AED(首付约${Math.round(d.down_payment_aed / 1000)}万${d.monthly_payment_aed ? `,月供约${Math.round(d.monthly_payment_aed / 1000)}千` : ''})。预算内可考虑:${areas || '暂无足够数据的区域'}。(假设:首付${d.assumptions.down_pct * 100}%、利率${d.assumptions.rate * 100}%、${d.assumptions.years}年)`,
        mapAction: d.affordable_areas?.length ? { type: 'highlight_areas', areas: d.affordable_areas.map((a: any) => a.area_name) } : undefined
      }
    }

    case 'project_value_check': {
      const data = await apiFetch<any>(`/api/ai/analytics/project-value?project_id=${encodeURIComponent(params.project_id)}`)
      if (data.error || data.market === null || data.area_median_aed == null) {
        return { result: data, summary: `${data.project_name || '该项目'} 暂无可比片区成交,给不出对标。` }
      }
      const dir = data.premium_pct >= 0 ? `高 ${data.premium_pct}%` : `低 ${Math.abs(data.premium_pct)}%`
      return {
        result: data,
        summary: `${data.project_name}(${data.bedrooms}居)报价约 ${Math.round(data.asking_price_aed / 1000)}万,比 ${data.area} 二手中位 ${Math.round(data.area_median_aed / 1000)}万${dir}。片区收益 ${data.area_yield_pct ?? '—'}%、3年涨 ${data.area_cagr_pct ?? '—'}%(期房通常带溢价,置信度${data.confidence})。`
      }
    }

    case 'purchase_costs': {
      const data = await apiFetch<any>(`/api/ai/analytics/costs?price=${params.price}&mortgage=${params.mortgage ? 'true' : 'false'}`)
      const c = data.costs
      return {
        result: data,
        summary: `买 ${Math.round(data.price_aed / 1000)}万的房,一次性费用约 ${Math.round(data.total_fees_aed / 1000)}万(${data.total_fees_pct}%):过户费 ${Math.round(c.dld_transfer_4pct / 1000)}万、中介 ${Math.round(c.agent_2pct / 1000)}万${c.mortgage_registration ? `、房贷登记 ${Math.round(c.mortgage_registration / 1000)}千` : ''}。连房价共约 ${Math.round(data.all_in_aed / 1000)}万。`
      }
    }

    case 'rent_vs_buy': {
      const qs = new URLSearchParams()
      qs.set('area', params.area)
      if (params.property_type) qs.set('property_type', params.property_type)
      if (params.bedrooms !== undefined) qs.set('bedrooms', String(params.bedrooms))
      if (params.years) qs.set('years', String(params.years))
      const data = await apiFetch<any>(`/api/ai/analytics/rent-vs-buy?${qs.toString()}`)
      if (data.error) return { result: data, summary: `${params.area} 数据不足,暂时算不了租 vs 买。` }
      return {
        result: data,
        summary: `${data.area} ${data.years}年:买(净成本约 ${Math.round(data.buy_net_cost_aed / 1000)}万,已计增值)vs 租(共约 ${Math.round(data.rent_total_aed / 1000)}万)→ 更划算:${data.verdict === 'buy' ? '买' : '租'}。(指示性,未计房贷利息/物业费)`
      }
    }

    default:
      return {
        result: null,
        summary: `Unknown tool: ${toolName}`
      }
  }
}
