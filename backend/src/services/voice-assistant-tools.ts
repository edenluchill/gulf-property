/**
 * Voice Assistant Tools Definition
 *
 * These tools allow the AI to interact with the map and search properties.
 * All DB access goes through localhost API endpoints — no direct pool import.
 */
import { counter, histogram } from '../telemetry'
// 纯函数（不碰 DB），用来判断「匹配到的区名」和「用户说的」是不是同一个东西
import { normalizeAreaName } from './area-matcher'
// 产品说明书（纯数据 + 关键词匹配，不碰 DB）—— Luna 用它回答「这个功能在哪」
import { findFeatures, describeFeature } from './product-guide'

/**
 * 工具的数据来源。**线上永远是本机回环**（工具和 API 同进程同容器）。
 *
 * `LUNA_TOOLS_API_BASE` 只给跑分脚本用 —— `scripts/luna-eval-live.ts` 在我的机器上
 * 跑真实 Live 会话，但工具得打到**已部署的生产 API**，否则测的是本地旧代码。
 * 本地起一个后端来凑数是更糟的选择:本机 ts-node-dev 残留会连着生产库作乱。
 */
const API_BASE = process.env.LUNA_TOOLS_API_BASE || `http://localhost:${process.env.PORT || 3000}`

/**
 * AED 绝对值 → 中文「万」。
 *
 * 🔴 **是 / 10000,不是 / 1000。** 全站曾有 **10 处**写成 `/ 1000` 然后说「万」——
 * 于是 Luna 对客户播报的**每一个金额都放大了 10 倍**:
 *   · 232 万的区域中位价 → 她说「中位约 **2321万**」
 *   · 客户说「我预算 300 万」→ 她复述成「预算 **3000万**内」
 * (2026-07-13 由质量遥测的 ai_apologized 线索顺藤摸出来的。)
 *
 * 金额一律走这个函数,别再手写除法。
 */
function wan(aed: number | null | undefined): string {
  const n = Number(aed)
  if (!Number.isFinite(n)) return '—'
  return String(Math.round(n / 10000))
}

/**
 * 中文口音/音译的开发商名 → 官方英文名。
 *
 * **为什么在这里而不在提示词里**:这张表原来是系统提示词的一部分(30 行中文)。
 * 模型层跑分抓到:客户全程说英文，Luna 却时不时冒出「带您看看迪拜码头。Dubai Marina
 * is a stunning…」—— 一句话里中英对切。提示词里**残留的任何中文块都是语言漂移的诱因**,
 * few-shot 的信号强度远超那条「跟着用户的语言说」的规则。
 *
 * 归一化本来就是工具层的活。放这里既消掉了漂移诱因,又让它可测试、可扩展。
 */
const DEVELOPER_ALIASES: Record<string, string> = {
  伊曼: 'Emaar', 艾玛: 'Emaar', 艾马: 'Emaar', 依玛尔: 'Emaar', 埃玛尔: 'Emaar', 伊玛尔: 'Emaar',
  达马克: 'DAMAC', 达马: 'DAMAC', 迪马克: 'DAMAC', 大马克: 'DAMAC',
  纳克希尔: 'Nakheel', 纳希尔: 'Nakheel',
  索巴: 'Sobha', 苏巴: 'Sobha', 哈特兰: 'Sobha', 索巴地产: 'Sobha',
  迈拉斯: 'Meraas', 美睿思: 'Meraas',
  宾加提: 'Binghatti', 宾哈提: 'Binghatti', 滨海提: 'Binghatti',
  多瑙河: 'Danube', 达努比: 'Danube',
}

/** 有中文就查表；查不到原样返回（后端还有 trigram 模糊匹配兜底）。 */
function normalizeDeveloper(raw: string | undefined): string | undefined {
  if (!raw) return raw
  if (!/[一-鿿]/.test(raw)) return raw
  for (const [zh, en] of Object.entries(DEVELOPER_ALIASES)) {
    if (raw.includes(zh)) return en
  }
  return raw
}

/** AED → 「千」(小额:月供、房贷登记费)。 */
function qian(aed: number | null | undefined): string {
  const n = Number(aed)
  if (!Number.isFinite(n)) return '—'
  return String(Math.round(n / 1000))
}


async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`)
  return res.json() as Promise<T>
}

// KHDA official school rating → Chinese label (6-tier scale). Lets Luna speak it.
const KHDA_ZH: Record<string, string> = {
  'outstanding': '卓越', 'very good': '优秀', 'good': '良好',
  'acceptable': '合格', 'weak': '欠佳', 'very weak': '很差',
}
const khdaZh = (r?: string | null): string | null =>
  r ? (KHDA_ZH[r.trim().toLowerCase()] || r) : null

// Tool definitions for Gemini Live API
export const voiceAssistantTools = [
  {
    functionDeclarations: [
      {
        name: 'explain_feature',
        description: 'Answer a question about how to USE this product — what a feature does, where to find it, who it is for. Call this whenever the user asks about the app itself rather than about property data: "how do I do a live call", "where is X", "can I send this to my client", "how do I share", "what does this cost". NEVER guess a product answer or claim you can do something for them (you cannot send, email, or message anything) — call this tool and relay what it returns.',
        parameters: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The user\'s question about the product, in their own words. Pass it through verbatim — the matcher handles phrasing.'
            }
          },
          required: ['question']
        }
      },
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
      },
      {
        name: 'present_place',
        description: 'Start a short guided walkthrough of ONE project or ONE area on the map: it auto-plays 3 stops — advantages (区域指标), environment (nearby amenities + distances), and recent DLD transactions (成交). Use this when the customer asks whether a specific project/area is good, says "show me / 带我看 / 介绍一下 X", or wants a tour of a place. Prefer this over answering in one long sentence — the walkthrough shows each thing visually. After calling it, say ONE short intro sentence only (the on-screen panel narrates each stop).',
        parameters: {
          type: 'object',
          properties: {
            project_id: { type: 'string', description: 'The project id to walk through (when the customer is asking about a specific project). Provide this OR area_name.' },
            area_name: { type: 'string', description: 'The Dubai area name to walk through (e.g. "Dubai Marina"). Provide this OR project_id.' }
          }
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

/**
 * 工具执行的**唯一分发处** —— 语音 / 文字 / 服务端 Live 三条路径全部经过这里。
 * 包一层就能覆盖全部 23 个工具:成功率、耗时、以及最要命的 **unknown tool**。
 *
 * 为什么 unknown 要单独计:工具声明在**三处**(前端声明 / 后端执行器 / 提示词),
 * 会漂移。漂移之后 default 分支返回 "Unknown tool: X",但 HTTP 仍是 **200 + success**,
 * 在监控上**完全隐形** —— Luna 表面在工作,实际那个工具根本没执行。
 */
export async function executeTool(
  toolName: string,
  params: any
): Promise<{ result: any; summary: string; mapAction?: any }> {
  const t0 = Date.now()
  try {
    const out = await executeToolInner(toolName, params)
    counter('voice.tool', { tool: toolName.slice(0, 40), result: classifyOutcome(out) }).inc()
    histogram('voice.tool.ms', { tool: toolName.slice(0, 40) }).observe(Date.now() - t0)
    return out
  } catch (e) {
    counter('voice.tool', { tool: toolName.slice(0, 40), result: 'error' }).inc()
    histogram('voice.tool.ms', { tool: toolName.slice(0, 40) }).observe(Date.now() - t0)
    throw e
  }
}

/**
 * 工具**业务结果**分类。
 *
 * 🔴 2026-08-10 审计发现:旧版只分 `ok`/`unknown`/`error`,于是
 * `AREA_NOT_FOUND`、`AREA_AMBIGUOUS`、0 结果**全部记成 `ok`**。
 * 看板上 60 天 32 次调用 0 失败、一片健康 —— 而同期真实 transcript 里
 * session 51 连着两轮「找不到 Diamond 2」、session 53 三轮全在澄清,
 * 用户当场就走了。**"没干活"和"干成了"记成同一件事,等于监控是瞎的。**
 * 见 memory `silent-failure-paths`(同款:返回 200 但没干活)。
 *
 * 这几档要**分开看**:`not_found` 高 = 数据缺口;`ambiguous` 高 = 匹配器该调;
 * `empty` 高 = 搜索条件太窄。三种病因完全不同,混成 ok 就一个都定位不了。
 */
function classifyOutcome(out: { result: any; summary: string }): string {
  const s = typeof out?.summary === 'string' ? out.summary : ''
  if (s.startsWith('Unknown tool')) return 'unknown'
  if (/AREA_AMBIGUOUS|needs_disambiguation/i.test(s)) return 'ambiguous'
  if (/AREA_NOT_FOUND|FEATURE_UNKNOWN|NOT_FOUND/i.test(s)) return 'not_found'
  // 0 结果:搜索类工具查到了但一条没有 —— 和"查不到这个地方"是两回事。
  const r = out?.result
  if (r && typeof r === 'object') {
    if (Array.isArray(r) && r.length === 0) return 'empty'
    if (typeof r.count === 'number' && r.count === 0) return 'empty'
    if (Array.isArray(r.projects) && r.projects.length === 0) return 'empty'
  }
  return 'ok'
}

async function executeToolInner(
  toolName: string,
  params: any
): Promise<{ result: any; summary: string; mapAction?: any }> {
  switch (toolName) {
    /**
     * 产品指路。**Luna 对产品本身一无所知曾经害死过一通对话**：
     * 客户问 "How can I do live calling?"，她答 "I can't help with live calling"
     * —— 而实时带看是真实存在的功能，房间还免费。
     * 反向也犯过：客户说「能不能把资料发给我老婆」，她答「我可以发给您」，
     * 但她**发不了任何东西**。凭空发明能力比拒绝更糟，客户会一直等。
     */
    case 'explain_feature': {
      const q = String(params.question || '')
      const hits = findFeatures(q)
      if (!hits.length) {
        return {
          result: { status: 'unknown_feature', asked: q },
          summary:
            `FEATURE_UNKNOWN: nothing in the product matches "${q}". Say you're not sure that exists here and ask what they're trying to accomplish. ` +
            `**Do NOT invent a feature, and do NOT offer to send, email, message or deliver anything yourself — you have no way to do that.**`,
        }
      }
      // 语言中立:两种语言都给，由模型按客户的语言挑
      const top = hits[0].feature
      const detail = { zh: describeFeature(top, 'zh'), en: describeFeature(top, 'en') }
      const alsoRelevant = hits.slice(1).map(h => h.feature.name.en)
      return {
        result: { matched: top.id, detail, also_relevant: alsoRelevant },
        summary:
          `Product answer for "${q}" → ${top.name.en}. Tell the user in THEIR language, in 2-3 spoken sentences: ` +
          `what it does, and concretely where to click. Facts: ${JSON.stringify(detail.en)}. ` +
          (top.caveat ? `Mention the caveat — it is the thing people get wrong. ` : '') +
          (top.audience === 'agent-pro' || top.audience === 'agent'
            ? `This is an agent-side feature; if they sound like a buyer, say their agent can do it for them. `
            : '') +
          `Never claim you will send or deliver anything yourself.` +
          (alsoRelevant.length ? ` Related, only if they ask: ${alsoRelevant.join(', ')}.` : ''),
      }
    }

    case 'search_projects': {
      const qs = new URLSearchParams()
      if (params.area) qs.set('area', params.area)
      if (params.min_price) qs.set('min_price', String(params.min_price))
      if (params.max_price) qs.set('max_price', String(params.max_price))
      if (params.bedrooms !== undefined) qs.set('bedrooms', String(params.bedrooms))
      // 中文音译的开发商名在这里归一化（"达马克" → "DAMAC"）。
      // 后端的 trigram 模糊匹配只对拉丁字母有效，中文进去必然 0 结果。
      if (params.developer) qs.set('developer', normalizeDeveloper(params.developer)!)
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
      // 契约必须和 present_place 完全一致。
      // 不一致的后果实测到了:模型同时收到「Flying to X」和「找不到 X」两个信号，
      // 于是说出「Flying to The Village area. I couldn't find an area named "The Village".」
      // —— 一句话里自相矛盾，客户直接懵掉。
      const data = await apiFetch<{
        status: 'matched' | 'ambiguous' | 'not_found'
        asked: string
        area: { id: string; name: string; lat: number; lng: number; confidence: number } | null
        candidates: { name: string; confidence: number }[]
      }>(`/api/ai/areas/match?q=${encodeURIComponent(params.area_name)}`)

      if (data?.status === 'ambiguous') {
        const opts = (data.candidates || []).map(c => c.name).slice(0, 3)
        return {
          result: { status: 'ambiguous', asked: params.area_name, candidates: opts },
          // 关键:**不给 mapAction**。地图不动，模型也就没有「已经飞过去了」的错觉。
          summary: `AREA_AMBIGUOUS: "${params.area_name}" could mean ${opts.map(o => `"${o}"`).join(' or ')}. Ask which one they mean before moving the map. Do not say you are flying anywhere yet.`,
        }
      }
      if (!data?.area) {
        return {
          result: { status: 'not_found', asked: params.area_name },
          summary: `AREA_NOT_FOUND: no Dubai area matches "${params.area_name}". Say you don't have it and ask for another. Do not fly anywhere and do not substitute a different area.`,
        }
      }
      return {
        result: { area: data.area.name, lat: data.area.lat, lng: data.area.lng, confidence: data.area.confidence },
        summary: `Flying to ${data.area.name}.` +
          (data.area.confidence < 0.8 && normalizeAreaName(data.asked) !== normalizeAreaName(data.area.name)
            ? ` NOTE: the user said "${data.asked}" — confirm "${data.area.name}" is what they meant.`
            : ''),
        mapAction: { type: 'fly_to', lat: data.area.lat, lng: data.area.lng, zoom: 11 },
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

      const near = await apiFetch<{ pois: { name: string; category: string; lat: number; lng: number; distance_meters: number; khda_rating?: string | null; description_zh?: string | null }[] }>(
        `/api/dubai-pois/near?lat=${area.lat}&lng=${area.lng}&radius=10000&categories=${SPECS.map(s => s.cat).join(',')}`
      )
      const pois = near.pois || []

      const spokes: { category: string; label: string; emoji: string; name: string; lng: number; lat: number; distanceKm: number; khdaRating?: string | null }[] = []
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
          lng: hit.lng, lat: hit.lat, distanceKm: Number(km.toFixed(2)),
          khdaRating: hit.khda_rating || null,
        })
      }
      // Nearest KHDA-rated school within 5km — cited separately so it never
      // distorts the proximity score or masks a closer (unrated) school.
      const ratedHit = pois.filter(p => p.category === 'school' && p.khda_rating && p.distance_meters <= 5000)
        .sort((a, b) => a.distance_meters - b.distance_meters)[0]
      const ratedSchool = ratedHit
        ? { name: ratedHit.name, khdaRating: ratedHit.khda_rating!, distanceKm: Number((ratedHit.distance_meters / 1000).toFixed(2)), description: ratedHit.description_zh || undefined }
        : null
      // Nearest hospital with a description — so Luna can describe it if asked.
      const hospHit = pois.filter(p => p.category === 'hospital' && p.description_zh && p.distance_meters <= 8000)
        .sort((a, b) => a.distance_meters - b.distance_meters)[0]
      const nearestHospital = hospHit
        ? { name: hospHit.name, distanceKm: Number((hospHit.distance_meters / 1000).toFixed(2)), description: hospHit.description_zh || undefined }
        : null

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
          amenities: spokes.map(s => ({ type: s.label, name: s.name, distance_km: s.distanceKm, khda_rating: s.khdaRating || undefined })),
          nearest_rated_school: ratedSchool
            ? { name: ratedSchool.name, khda_rating: ratedSchool.khdaRating, khda_rating_zh: khdaZh(ratedSchool.khdaRating), distance_km: ratedSchool.distanceKm, description: ratedSchool.description }
            : undefined,
          nearest_hospital: nearestHospital || undefined,
        },
        summary: `${area.name} 生活便利度 ${score100}/100（${tier}）。最近：${list}。${ratedSchool ? `附近 ${ratedSchool.name}（约${ratedSchool.distanceKm}km）是 KHDA「${khdaZh(ratedSchool.khdaRating)}」官方评级学校（截至2023-24学年），适合有孩子的家庭。` : ''}`,
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
        return { result: { areas: [] }, summary: `预算 ${wan(params.budget)}万 AED 内暂时没有足够数据的区域,可以放宽预算或换户型。` }
      }
      const top = rows.slice(0, 3).map((r: any) =>
        `${r.area_name}(中位约 ${wan(r.median_price_aed)}万,毛收益 ${r.gross_yield_pct ?? '—'}%,3年涨 ${r.cagr_3y_pct ?? '—'}%)`
      ).join(';')
      return {
        result: { areas: rows },
        summary: `预算 ${wan(params.budget)}万内,按${params.goal || '综合'}推荐:${top}。(基于真实成交,指示性参考)`,
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
        summary: `${d.area} ${d.bedrooms ?? ''}居${d.ptype}${d.segment_used === 'offplan' ? '(期房口径)' : d.segment_requested === 'offplan' && d.segment_used === 'all' ? '(期房样本少,已含现房)' : ''}:中位价约 ${wan(d.median_price_aed)}万 AED,毛租金收益 ${d.gross_yield_pct ?? '—'}%,近3年年化 ${d.cagr_3y_pct ?? '—'}%。指示性5年总回报约 ${p.total_roi_pct ?? '—'}%,回本约 ${p.payback_years ?? '—'} 年(样本置信度 ${d.sample?.confidence};指示性,非保证)。`
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
        summary: `${d.area} ${d.bedrooms ?? ''}居${d.ptype}${d.segment_used === 'offplan' ? '(期房口径)' : d.segment_requested === 'offplan' && d.segment_used === 'all' ? '(期房样本少,已含现房)' : ''}:中位 ${wan(pr.median_price_aed)}万 AED(${pr.median_price_sqm}/㎡,比全城${vsCity}),近3年年化 ${t.cagr_3y_pct}%、同比 ${t.yoy_pct}%(${t.direction}),毛收益 ${y.gross_yield_pct ?? '—'}%,指示性5年ROI ${p.total_roi_pct}%、回本 ${p.payback_years ?? '—'}年,流动性${d.liquidity.level}(置信度${d.sample.confidence})。净收益/供给/人口数据暂缺。`
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
        .map((a: any) => `${a.area_name}(中位${wan(a.median_price_aed)}万,收益${a.gross_yield_pct ?? '—'}%)`).join(';')
      return {
        result: d,
        summary: `按你的条件大约能买到 ${wan(d.max_price_aed)}万 AED(首付约${wan(d.down_payment_aed)}万${d.monthly_payment_aed ? `,月供约${qian(d.monthly_payment_aed)}千` : ''})。预算内可考虑:${areas || '暂无足够数据的区域'}。(假设:首付${d.assumptions.down_pct * 100}%、利率${d.assumptions.rate * 100}%、${d.assumptions.years}年)`,
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
        summary: `${data.project_name}(${data.bedrooms}居)报价约 ${wan(data.asking_price_aed)}万,比 ${data.area} ${data.segment_used === 'offplan' ? '期房成交中位' : '成交中位'} ${wan(data.area_median_aed)}万${dir}。片区收益 ${data.area_yield_pct ?? '—'}%、3年涨 ${data.area_cagr_pct ?? '—'}%(置信度${data.confidence})。`
      }
    }

    case 'purchase_costs': {
      const data = await apiFetch<any>(`/api/ai/analytics/costs?price=${params.price}&mortgage=${params.mortgage ? 'true' : 'false'}`)
      const c = data.costs
      return {
        result: data,
        summary: `买 ${wan(data.price_aed)}万的房,一次性费用约 ${wan(data.total_fees_aed)}万(${data.total_fees_pct}%):过户费 ${wan(c.dld_transfer_4pct)}万、中介 ${wan(c.agent_2pct)}万${c.mortgage_registration ? `、房贷登记 ${qian(c.mortgage_registration)}千` : ''}。连房价共约 ${wan(data.all_in_aed)}万。`
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
        summary: `${data.area} ${data.years}年:买(净成本约 ${wan(data.buy_net_cost_aed)}万,已计增值)vs 租(共约 ${wan(data.rent_total_aed)}万)→ 更划算:${data.verdict === 'buy' ? '买' : '租'}。(指示性,未计房贷利息/物业费)`
      }
    }

    case 'present_place': {
      // Assemble a 3-stop guided walkthrough (优势 / 环境 / 成交) for a project or area.
      const SPECS = [
        { cat: 'metro_station', zh: '地铁', emoji: '🚇', ideal: 1.5, zero: 5,  weight: 0.25 },
        { cat: 'school',        zh: '学校', emoji: '🏫', ideal: 1.5, zero: 6,  weight: 0.20 },
        { cat: 'mall',          zh: '商场', emoji: '🛍️', ideal: 3,   zero: 8,  weight: 0.20 },
        { cat: 'hospital',      zh: '医院', emoji: '🏥', ideal: 2,   zero: 10, weight: 0.20 },
        { cat: 'supermarket',   zh: '超市', emoji: '🛒', ideal: 1,   zero: 4,  weight: 0.15 },
      ] as const
      const lastNonNull = (arr: any[] | undefined | null) => {
        if (!arr) return null
        for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]
        return null
      }

      // 1) Resolve focus → name, coords, dubai_areas UUID, optional projectId
      let name = '', area = '', lat: number | null = null, lng: number | null = null
      let uuid: string | null = null, projectId: string | null = null
      let image: string | null = null  // a photo so the customer recognises the place
      let matchCaveat: string | null = null  // set when the area match wasn't a slam dunk
      if (params.project_id) {
        const d = await apiFetch<{ result: any }>(`/api/ai/projects/${encodeURIComponent(params.project_id)}/detail`).catch(() => null)
        const r = d?.result
        if (!r || r.latitude == null) return { result: null, summary: '没找到这个项目的位置，换个项目我再带你看。' }
        projectId = String(params.project_id); name = (r.projectName || r.project_name || '').trim(); area = (r.area || '').trim()
        lat = Number(r.latitude); lng = Number(r.longitude)
        image = r.image || r.primary_image || null
        if (area) {
          const m = await apiFetch<{ area: { id: string } | null }>(`/api/ai/areas/match?q=${encodeURIComponent(area)}`).catch(() => null)
          uuid = m?.area?.id || null
        }
      } else if (params.area_name) {
        const m = await apiFetch<{
          status: 'matched' | 'ambiguous' | 'not_found'
          asked: string
          area: { id: string; name: string; lat: number; lng: number; confidence: number } | null
          candidates: { name: string; confidence: number }[]
        }>(`/api/ai/areas/match?q=${encodeURIComponent(params.area_name)}`).catch(() => null)

        // 匹配不确定时**绝不猜**。旧版在这里拿到什么就用什么，于是 "Dubai Harbor"
        // 变成 D3、"JVC" 变成 Jebel Ali Village，Luna 照着错区域讲得有鼻子有眼。
        if (!m || m.status === 'not_found') {
          return {
            result: { status: 'not_found', asked: params.area_name },
            summary: `AREA_NOT_FOUND: no Dubai area matches "${params.area_name}". Tell the user you don't have that area and ask them to name another. Do NOT substitute a different area.`,
          }
        }
        if (m.status === 'ambiguous' || !m.area) {
          const opts = (m.candidates || []).map(c => c.name).slice(0, 3)
          return {
            result: { status: 'ambiguous', asked: params.area_name, candidates: opts },
            summary: `AREA_AMBIGUOUS: "${params.area_name}" could mean ${opts.map(o => `"${o}"`).join(' or ')}. Ask the user which one they mean, in their language. Do NOT pick one yourself and do NOT start the walkthrough yet.`,
          }
        }
        name = (m.area.name || '').trim(); area = name; uuid = m.area.id; lat = m.area.lat; lng = m.area.lng
        // 低置信度也放行，但要让模型主动跟客户核对一句
        if (m.area.confidence < 0.8 && normalizeAreaName(m.asked) !== normalizeAreaName(name)) {
          matchCaveat = `The user said "${m.asked}"; closest area on the map is "${name}" (confidence ${m.area.confidence}). Confirm this is what they meant before going deep.`
        }
      } else {
        return { result: null, summary: '告诉我想看哪个项目或区域，我带你走一圈。' }
      }

      // 2) Fetch the three stops' data in parallel (+ a representative photo for areas)
      const [insights, near, tx, areaImg] = await Promise.all([
        uuid ? apiFetch<any>(`/api/market/area-insights?areaId=${encodeURIComponent(uuid)}`).catch(() => null) : Promise.resolve(null),
        (lat != null && lng != null)
          ? apiFetch<{ pois: any[] }>(`/api/dubai-pois/near?lat=${lat}&lng=${lng}&radius=10000&categories=${SPECS.map(s => s.cat).join(',')}`).catch(() => ({ pois: [] }))
          : Promise.resolve({ pois: [] }),
        projectId ? apiFetch<any>(`/api/residential-projects/${encodeURIComponent(projectId)}/transactions`).catch(() => null) : Promise.resolve(null),
        // Area tour has no photo of its own → borrow one project's image so the
        // customer still sees a picture of the place.
        (!projectId && area)
          ? apiFetch<{ projects: any[] }>(`/api/ai/projects/search?area=${encodeURIComponent(area)}`).then(d => d.projects?.find((p: any) => p.image || p.primary_image)).then(p => p?.image || p?.primary_image || null).catch(() => null)
          : Promise.resolve(null),
      ])
      if (!image && areaImg) image = areaImg

      // 优势 — area metrics; for a project, prefer the project's own comp median
      // (the area 'all' median can be villa-skewed and misrepresent the project).
      let pricePerSqm = lastNonNull(insights?.price)
      const growth = lastNonNull(insights?.growth)
      const yieldNow = lastNonNull(insights?.rentalYield)
      let medianUnit = insights?.medianUnitPrice ?? null
      if (projectId && tx?.sales?.length >= 3) {
        const med = (arr: number[]) => arr.length ? arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)] : null
        const prices = tx.sales.map((s: any) => s.price).filter((v: any) => v > 0)
        const ppss = tx.sales.map((s: any) => s.pricePerSqm).filter((v: any) => v > 0)
        if (prices.length) medianUnit = med(prices)
        if (ppss.length) pricePerSqm = med(ppss)
      }

      // 环境 — amenity spokes + score
      const pois = (near as any)?.pois || []
      const spokes: any[] = []
      let score = 0
      for (const s of SPECS) {
        const hit = pois.filter((p: any) => p.category === s.cat).sort((a: any, b: any) => a.distance_meters - b.distance_meters)[0]
        if (!hit) continue
        const km = hit.distance_meters / 1000
        score += s.weight * Math.max(0, Math.min(1, (s.zero - km) / (s.zero - s.ideal)))
        spokes.push({ category: s.cat, label: s.zh, emoji: s.emoji, name: hit.name, lng: hit.lng, lat: hit.lat, distanceKm: Number(km.toFixed(2)), khdaRating: hit.khda_rating || null })
      }
      // Nearest KHDA-rated school within 5km, cited separately (doesn't distort score).
      const envRatedHit = pois.filter((p: any) => p.category === 'school' && p.khda_rating && p.distance_meters <= 5000)
        .sort((a: any, b: any) => a.distance_meters - b.distance_meters)[0]
      const envHospHit = pois.filter((p: any) => p.category === 'hospital' && p.description_zh && p.distance_meters <= 8000)
        .sort((a: any, b: any) => a.distance_meters - b.distance_meters)[0]
      const score100 = Math.round(score * 100)
      const tier = score100 >= 75 ? '优秀' : score100 >= 55 ? '良好' : score100 >= 35 ? '一般' : '偏远'

      // 成交 — project comps (precise) or area recent transactions
      let sales: any[] = []
      if (tx?.sales?.length) sales = tx.sales.slice(0, 5)
      else if (insights?.recentTransactions?.length) {
        sales = insights.recentTransactions.slice(0, 5).map((t: any) => ({ date: t.date, building: t.building, rooms: t.rooms, sizeSqm: t.sizeSqm, price: t.price }))
      }

      const wan = (v: number | null) => v != null ? `${Math.round(v / 10000)}万` : '—'
      const head = `${name}${area && area !== name ? '·' + area : ''}`
      // Lead the spoken line with positives (the growth chart still shows the real,
      // possibly-negative number in the card — nothing hidden, just not the opener).
      const advParts: string[] = []
      if (yieldNow != null) advParts.push(`回报约 ${Number(yieldNow).toFixed(1)}%`)
      if (growth != null && growth >= 0) advParts.push(`近一年涨 ${Number(growth).toFixed(1)}%`)
      const stops: any[] = []
      stops.push({
        kind: 'advantages',
        line: advParts.length ? `${head}：${advParts.join('、')}，先看硬指标。` : `${head}：先看硬指标。`,
        metrics: { medianUnitPrice: medianUnit, pricePerSqm, rentalYield: yieldNow, capitalGrowth: growth },
      })
      if (spokes.length) stops.push({
        kind: 'environment',
        line: `生活很方便——${spokes.slice(0, 3).map(s => `${s.label} ${s.distanceKm.toFixed(1)}km`).join('、')}${envRatedHit ? `；${envRatedHit.name} 是 KHDA「${khdaZh(envRatedHit.khda_rating)}」官方评级学校` : ''}。`,
        center: [lng, lat], score: score100, tier, spokes,
      })
      if (sales.length) stops.push({
        kind: 'transactions',
        line: `最近成交也活跃${sales[0]?.price ? `，比如 ${wan(sales[0].price)}` : ''}。`,
        sales,
      })

      if (!stops.length) {
        return {
          result: { name, data: 'sparse' },
          summary: `Walkthrough started for ${name}, but market data is thin here. Say so briefly and offer to look at a nearby area.`,
          mapAction: { type: 'fly_to', lat, lng, zoom: 14 },
        }
      }

      // ⚠️ **绝不要把 stops[].line 喂回模型。**
      //
      // 那些 line 是**写死的中文**（"先看硬指标。" / "生活很方便——"），是给地图面板
      // 渲染用的 UI 文案。旧版把它们连同一句中文祈使句一起塞进 summary：
      //
      //   `已开始带看 X。请用口语顺着把这三站讲出来，自然连贯…：\n1. 先看硬指标。…`
      //
      // 这不是数据，是**一条中文指令**。于是全程说英语的客户会突然听到 Luna 冒出
      // "好的，我这就带您看看 The Oasis by Emaar" —— 语言乱跳的头号真凶。
      //
      // 现在给模型的是**语言中立的结构化事实**，由它用客户的语言自己组织措辞。
      const facts: Record<string, unknown> = {}
      if (yieldNow != null) facts.rental_yield_pct = Number(Number(yieldNow).toFixed(1))
      if (growth != null) facts.price_growth_1y_pct = Number(Number(growth).toFixed(1))
      if (medianUnit != null) facts.median_unit_price_aed = medianUnit
      if (spokes.length) {
        facts.amenities = spokes.slice(0, 3).map(s => ({ kind: s.label, distance_km: Number(s.distanceKm.toFixed(1)) }))
        if (score100 != null) facts.convenience_score = score100
      }
      if (envRatedHit) {
        facts.nearest_rated_school = {
          name: envRatedHit.name,
          // 评级用**语言无关的官方英文档位**，中文由模型按客户语言自己翻。
          // 直接塞 khda_rating_zh 等于又往模型嘴里塞中文。
          khda_rating: envRatedHit.khda_rating,
        }
      }
      if (envHospHit) facts.nearest_hospital = { name: envHospHit.name }
      if (sales.length && sales[0]?.price) facts.recent_sale_price_aed = sales[0].price

      return {
        result: {
          name, area, stops: stops.map(s => s.kind), facts,
          // 学校/医院的中文简介只在客户**主动问起**时才用得上；单独放，
          // 不进 summary，免得模型顺手照读一段中文。
          nearby_school_detail: envRatedHit?.description_zh || undefined,
          nearby_hospital_detail: envHospHit?.description_zh || undefined,
        },
        summary:
          `Guided walkthrough started for ${name}; the map is animating through ${stops.length} stops. ` +
          `Narrate it in 2-3 spoken sentences IN THE USER'S LANGUAGE using only these facts: ${JSON.stringify(facts)}. ` +
          `Speak like an agent showing the place in person — don't read the JSON, don't enumerate "three stops".` +
          (matchCaveat ? ` NOTE: ${matchCaveat}` : ''),
        mapAction: { type: 'guided_tour', tour: { kind: projectId ? 'project' : 'area', projectId, name, area, lat, lng, image, stops } },
      }
    }

    default:
      return {
        result: null,
        summary: `Unknown tool: ${toolName}`
      }
  }
}
