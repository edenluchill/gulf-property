/**
 * Voice Assistant Context
 *
 * Phase-based voice assistant with transient bubble UI:
 * - Single-tap: idle → connect + auto-mic (VAD mode)
 * - Single-tap again: deactivate everything
 * - Gemini handles VAD turn detection (always-on mic)
 * - Latest assistant message shown as transient bubble (auto-fade 8s)
 * - 200ms throttled bubble updates for transcription fragments
 * - Auto-reconnect with exponential backoff (3 attempts)
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode
} from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GoogleGenAI, Modality, LiveServerMessage, Type, StartSensitivity, EndSensitivity } from '@google/genai'
import {
  VoicePhase,
  BubbleContent,
  MapAction,
  MessageAttachment
} from '../hooks/voice-assistant/types'
import { AudioRecorder, AudioPlayer } from '../hooks/voice-assistant/audioUtils'
import { voiceDebugLogger } from '../hooks/voice-assistant/debugLogger'
import { trackEvent, visitorId } from '../lib/track'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'
const GEMINI_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025'
const BUBBLE_FLUSH_MS = 200
const AUTO_RECONNECT_MAX = 3
const AUTO_RECONNECT_BASE_MS = 1000

// Tool definitions
const voiceTools = [
  {
    functionDeclarations: [
      {
        name: 'capture_contact',
        description: "Save the customer's contact details so the agent can follow up with full property info. Call this ONLY after the customer has shown clear interest and agreed to share contact (e.g. they said yes to receiving details on WhatsApp). Ask naturally; never pressure. Provide whatever details the customer gave.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "Customer's name if given" },
            whatsapp: { type: Type.STRING, description: 'WhatsApp number with country code, e.g. +971501234567' },
            phone: { type: Type.STRING, description: 'Phone number if different from WhatsApp' },
            email: { type: Type.STRING, description: 'Email address if given' }
          }
        }
      },
      {
        name: 'search_projects',
        description: 'Search for properties/projects in Dubai. Use when user asks to find, search, or look for properties, apartments, villas, or real estate. Returns list of matching projects.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            area: { type: Type.STRING, description: 'Dubai area name like "Dubai Marina", "Downtown", "JVC", "Business Bay"' },
            min_price: { type: Type.NUMBER, description: 'Minimum budget in AED (e.g., 1000000 for 1 million)' },
            max_price: { type: Type.NUMBER, description: 'Maximum budget in AED (e.g., 3000000 for 3 million)' },
            bedrooms: { type: Type.NUMBER, description: 'Number of bedrooms: 0=studio, 1, 2, 3, etc.' },
            developer: { type: Type.STRING, description: 'Developer name like "Emaar", "DAMAC", "Sobha"' }
          }
        }
      },
      {
        name: 'fly_to_area',
        description: 'Navigate/zoom the map to show a specific Dubai area. Use when user says "show me", "go to", "zoom to" an area.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            area_name: { type: Type.STRING, description: 'Area name to navigate to' }
          },
          required: ['area_name']
        }
      },
      {
        name: 'get_area_info',
        description: 'Get market data and statistics about a Dubai area: rental yield, price trends, transaction volume. Use when user asks about an area\'s investment potential or market performance.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            area_name: { type: Type.STRING, description: 'Area name to get info about' }
          },
          required: ['area_name']
        }
      },
      {
        name: 'show_nearby_pois',
        description: 'Show (or hide) a category of points-of-interest on the map as labeled markers. Drives the SAME map filter the customer can toggle by hand. Use when asked to show/hide schools, hospitals, malls, parks, restaurants, etc. near a location. Pass hide=true to hide a category.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            category: {
              type: Type.STRING,
              description: 'Category: hospital, clinic, pharmacy, school, university, mall, supermarket, restaurant, cafe, bank, atm, gas_station, hotel, mosque, church, park, gym, beach, cinema, police, fire_station, post_office, embassy'
            },
            hide: {
              type: Type.BOOLEAN,
              description: 'Set true to HIDE this category instead of showing it'
            }
          },
          required: ['category']
        }
      },
      {
        name: 'navigate_to_project',
        description: 'Navigate to a project: fly to it on map, show unit types and investment analysis, then open detail page. Use when user wants details, floor plans, investment analysis, or more info about a specific project.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            project_id: { type: Type.STRING, description: 'The project ID to navigate to (from search results)' },
            project_name: { type: Type.STRING, description: 'The project name (for confirmation)' }
          },
          required: ['project_id']
        }
      },
      {
        name: 'recommend_by_budget',
        description: 'Recommend the best Dubai areas to buy for a given budget. Use when the customer states a budget/income and a goal. Returns areas within budget ranked by goal with median price, gross rental yield %, 3-year price growth %, and confidence. Real DLD data.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            budget: { type: Type.NUMBER, description: 'Budget in AED (total purchase price), e.g. 1500000' },
            goal: { type: Type.STRING, description: "Goal: 'yield' (rental income), 'growth' (capital gain), or 'balanced' (default)" },
            property_type: { type: Type.STRING, description: "'apartment' (default), 'villa', or 'townhouse'" },
            bedrooms: { type: Type.NUMBER, description: 'Bedrooms: 0=studio, 1, 2, 3… Omit for any.' }
          },
          required: ['budget']
        }
      },
      {
        name: 'get_investment_breakdown',
        description: 'Investment analysis for a specific area + property type + bedrooms: median price, gross rental yield %, 3-year CAGR, and an INDICATIVE 5-year ROI projection with payback years. Use when the customer asks the ROI/yield/return for a specific area & unit type. Always relay confidence; projections are indicative, not guaranteed.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            area: { type: Type.STRING, description: 'Dubai area name, e.g. "Business Bay", "Dubai Marina"' },
            property_type: { type: Type.STRING, description: "'apartment' (default), 'villa', or 'townhouse'" },
            bedrooms: { type: Type.NUMBER, description: 'Bedrooms: 0=studio, 1, 2… Omit for any.' },
            offplan: { type: Type.BOOLEAN, description: 'true=off-plan only, false=ready only, omit=both' }
          },
          required: ['area']
        }
      },
      {
        name: 'compare_market',
        description: 'Controlled comparison over real DLD sales: hold conditions constant and vary ONE dimension to isolate its price effect. Use for "is off-plan pricier than ready here?" (vary=is_offplan), "price by bedroom?" (vary=bedrooms), "priciest areas?" (vary=area_name). Returns each group with transaction count + median price.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            vary: { type: Type.STRING, description: "Dimension to break down by: 'is_offplan', 'bedrooms', 'area_name', 'ptype', 'size_band', or 'year'" },
            property_type: { type: Type.STRING, description: "Hold property type constant: 'apartment', 'villa', 'townhouse'" },
            bedrooms: { type: Type.NUMBER, description: 'Hold bedrooms constant (0=studio)' },
            area: { type: Type.STRING, description: 'Restrict to an area (fuzzy), e.g. "Marina"' }
          },
          required: ['vary']
        }
      },
      {
        name: 'area_investment_report',
        description: 'Full investment report for an area + property type + bedrooms in ONE call: price level & range, 3-year & YoY growth, gross rental yield, indicative 5-year ROI & payback, liquidity, price vs city average, off-plan share, confidence, and an explicit list of data gaps. Use this as the DEFAULT for any "analyze / is it a good investment / give me the numbers" question — it is the most complete. Relay confidence and gaps honestly; projections are indicative.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            area: { type: Type.STRING, description: 'Dubai area, e.g. "Business Bay", "Dubai Marina", "JVC"' },
            property_type: { type: Type.STRING, description: "'apartment' (default), 'villa', 'townhouse'" },
            bedrooms: { type: Type.NUMBER, description: 'Bedrooms: 0=studio, 1, 2… Omit for any.' }
          },
          required: ['area']
        }
      },
      {
        name: 'check_affordability',
        description: 'Work out what the customer can afford from their monthly income OR cash for down-payment, then recommend areas within that budget. Use when the customer gives an income/salary or savings and asks what/where they can buy. Returns max purchase price, required down payment, monthly mortgage, and affordable areas with yield & growth.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            income: { type: Type.NUMBER, description: 'Monthly income in AED (for mortgage capacity)' },
            cash: { type: Type.NUMBER, description: 'Cash available for down payment in AED' },
            property_type: { type: Type.STRING, description: "'apartment' (default), 'villa', 'townhouse'" },
            bedrooms: { type: Type.NUMBER, description: 'Bedrooms: 0=studio, 1, 2…' }
          }
        }
      },
      {
        name: 'project_value_check',
        description: "Check whether a specific project's asking price is above or below the DLD resale median for its area & bedrooms. Use when the customer asks 'is this project fairly priced / a good deal / pricier than the area'. Needs project_id (from search results).",
        parameters: {
          type: Type.OBJECT,
          properties: { project_id: { type: Type.STRING, description: 'Project ID from search results' } },
          required: ['project_id']
        }
      },
      {
        name: 'purchase_costs',
        description: 'Break down one-time purchase costs of buying in Dubai (DLD 4% transfer, agent 2%, admin/trustee, mortgage registration) and the all-in total. Use when the customer asks about fees / total cost / extra cost to buy.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            price: { type: Type.NUMBER, description: 'Property price in AED' },
            mortgage: { type: Type.BOOLEAN, description: 'true if buying with a mortgage' }
          },
          required: ['price']
        }
      },
      {
        name: 'rent_vs_buy',
        description: 'Indicative rent-vs-buy comparison for an area/unit over N years. Use when the customer asks "should I rent or buy". Ignores mortgage interest & service charges (data gaps) — say so.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            area: { type: Type.STRING, description: 'Dubai area' },
            property_type: { type: Type.STRING, description: "'apartment' (default), 'villa', 'townhouse'" },
            bedrooms: { type: Type.NUMBER, description: 'Bedrooms (0=studio)' },
            years: { type: Type.NUMBER, description: 'Holding horizon in years (default 5)' }
          },
          required: ['area']
        }
      }
    ]
  }
]

interface VoiceAssistantContextType {
  // Phase-based state
  phase: VoicePhase
  latestBubble: BubbleContent | null
  toolStatus: string | null
  userTranscript: string   // live caption of the user's own speech

  // Actions
  activate: () => Promise<void>
  deactivate: () => void

  // Map action handler registration (for MapPage)
  registerMapActionHandler: (handler: (action: MapAction) => void) => void
  unregisterMapActionHandler: () => void

  // Navigate to project
  navigateToProject: (projectId: string) => void

  // Hide the global Luna pill (e.g. during a collab live tour)
  hidden: boolean
  setHidden: (v: boolean) => void
}

const VoiceAssistantContext = createContext<VoiceAssistantContextType | null>(null)

export function VoiceAssistantProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { i18n } = useTranslation()

  // Phase-based state
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [latestBubble, setLatestBubble] = useState<BubbleContent | null>(null)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  // Live caption of the USER's own speech (so they can see what they're saying)
  const [userTranscript, setUserTranscript] = useState<string>('')

  // Refs
  const sessionRef = useRef<any>(null)
  const connectingRef = useRef(false)
  const recorderRef = useRef<AudioRecorder | null>(null)
  const playerRef = useRef<AudioPlayer | null>(null)
  const mapActionHandlerRef = useRef<((action: MapAction) => void) | null>(null)
  // Half-duplex: true while Luna is speaking. We don't forward mic audio then, so her
  // own voice (picked up by the speaker→mic path) can't trigger a false interruption.
  const lunaSpeakingRef = useRef(false)
  const pendingActionRef = useRef<MapAction | null>(null)
  const systemInstructionRef = useRef<string>('')
  const startRecordingRef = useRef<(() => Promise<void>) | null>(null)

  // Live user-speech caption: accumulate this utterance; userTurnFreshRef flips true
  // after the assistant speaks so the NEXT user words start a fresh caption.
  const userTextAccumRef = useRef<string>('')
  const userTurnFreshRef = useRef<boolean>(true)
  // Latency diagnostics: stamp when this turn's user speech is first/last seen so we
  // can print the exact gap to Luna's first reply token in the console.
  const turnUserFirstTsRef = useRef<number>(0)
  const turnUserLastTsRef = useRef<number>(0)
  const turnReplyLoggedRef = useRef<boolean>(false)

  // Bubble accumulation: collect fragments, flush at most every 200ms
  const assistantTextAccumRef = useRef<string>('')
  const pendingAttachmentRef = useRef<MessageAttachment | null>(null)
  const stickyAttachmentRef = useRef<MessageAttachment | null>(null) // persists across turns
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFlushRef = useRef<number>(0)

  // Auto-reconnect
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intentionalDisconnectRef = useRef(false)
  // Gemini Live session resumption: the server periodically sends a handle that
  // captures full conversation state. We keep the latest so a reconnect resumes
  // WITH context (Luna doesn't forget). Cleared on a fresh, user-initiated open.
  const resumeHandleRef = useRef<string | null>(null)

  const currentLanguage = i18n.language?.startsWith('zh') ? 'zh' : 'en'

  // Tool display names
  const getToolDisplayName = useCallback((toolName: string): string => {
    const names: Record<string, string> = {
      'search_projects': currentLanguage === 'zh' ? '搜索项目中...' : 'Searching projects...',
      'fly_to_area': currentLanguage === 'zh' ? '定位区域中...' : 'Locating area...',
      'get_area_info': currentLanguage === 'zh' ? '获取区域信息...' : 'Getting area info...',
      'compare_areas': currentLanguage === 'zh' ? '对比区域中...' : 'Comparing areas...',
      'show_nearby_pois': currentLanguage === 'zh' ? '显示周边设施...' : 'Showing nearby places...',
      'navigate_to_project': currentLanguage === 'zh' ? '打开项目详情...' : 'Opening project...',
      'reset_map': currentLanguage === 'zh' ? '重置地图...' : 'Resetting map...',
      'recommend_by_budget': currentLanguage === 'zh' ? '按预算分析中...' : 'Analyzing by budget...',
      'get_investment_breakdown': currentLanguage === 'zh' ? '计算投资回报...' : 'Crunching ROI...',
      'compare_market': currentLanguage === 'zh' ? '对比市场数据...' : 'Comparing market...',
      'area_investment_report': currentLanguage === 'zh' ? '生成投资报告...' : 'Building report...',
      'check_affordability': currentLanguage === 'zh' ? '测算可负担...' : 'Checking affordability...',
      'project_value_check': currentLanguage === 'zh' ? '对标片区价格...' : 'Checking value...',
      'purchase_costs': currentLanguage === 'zh' ? '计算购房费用...' : 'Calculating costs...',
      'rent_vs_buy': currentLanguage === 'zh' ? '对比租与买...' : 'Rent vs buy...'
    }
    return names[toolName] || (currentLanguage === 'zh' ? '处理中...' : 'Processing...')
  }, [currentLanguage])

  // Flush accumulated assistant text to bubble
  const flushBubble = useCallback(() => {
    const text = assistantTextAccumRef.current.trim()
    // Use pending attachment, or carry forward the sticky one from previous turns
    const attachment = pendingAttachmentRef.current || stickyAttachmentRef.current
    if (!text && !attachment) return
    // Update sticky ref whenever we have a new pending attachment
    if (pendingAttachmentRef.current) {
      stickyAttachmentRef.current = pendingAttachmentRef.current
    }
    setLatestBubble({
      text,
      attachment: attachment || undefined,
      timestamp: Date.now()
    })
    lastFlushRef.current = Date.now()
    flushTimerRef.current = null
  }, [])

  // Throttled bubble update: accumulate text, flush at most every 200ms
  const scheduleBubbleFlush = useCallback(() => {
    const elapsed = Date.now() - lastFlushRef.current
    if (elapsed >= BUBBLE_FLUSH_MS) {
      flushBubble()
    } else if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(flushBubble, BUBBLE_FLUSH_MS - elapsed)
    }
  }, [flushBubble])

  // Handle map action
  const handleMapAction = useCallback((action: MapAction) => {
    console.log('[VoiceContext] Map action:', action, 'path:', location.pathname)

    if (action.type === 'navigate' && action.path) {
      navigate(action.path)
      return
    }

    if ((location.pathname === '/' || location.pathname === '/map') && mapActionHandlerRef.current) {
      mapActionHandlerRef.current(action)
      return
    }

    if (['fly_to', 'highlight_projects', 'show_pois', 'toggle_transport', 'show_area_info', 'highlight_areas', 'reset', 'measure_distance', 'amenity_spokes', 'guided_tour'].includes(action.type)) {
      pendingActionRef.current = action
      navigate('/')
    }
  }, [location.pathname, navigate])

  // Register/unregister map action handler
  const registerMapActionHandler = useCallback((handler: (action: MapAction) => void) => {
    mapActionHandlerRef.current = handler
    if (pendingActionRef.current) {
      handler(pendingActionRef.current)
      pendingActionRef.current = null
    }
  }, [])

  const unregisterMapActionHandler = useCallback(() => {
    mapActionHandlerRef.current = null
  }, [])

  // Navigate to project
  const navigateToProject = useCallback((projectId: string) => {
    navigate(`/project/${projectId}`)
  }, [navigate])

  // Execute tool
  const executeTool = useCallback(async (toolName: string, params: any, callId: string) => {
    voiceDebugLogger.logToolCallStart(callId, toolName, params)
    setPhase('processing')
    setToolStatus(getToolDisplayName(toolName))
    // Clear sticky attachment when new tool call starts — new results will replace
    stickyAttachmentRef.current = null

    // Lead capture is browser-local (needs the visitor_id to tie prior behaviour
    // to the lead) — handle it here, not via the generic backend tool path.
    // See docs/analytics-dashboard-spec.md §6.3.
    if (toolName === 'capture_contact') {
      try {
        const resp = await fetch(`${API_BASE}/api/leads/contact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visitor_id: visitorId(),
            name: params?.name,
            email: params?.email,
            phone: params?.phone,
            whatsapp: params?.whatsapp || params?.phone,
            source: 'luna',
          }),
        })
        const ok = resp.ok
        voiceDebugLogger.logToolCallEnd(callId, { ok })
        setToolStatus(null)
        return {
          success: ok,
          summary: ok
            ? '联系方式已记录,稍后把详细资料发过去。'
            : '暂时没能保存联系方式,可以稍后再留一次。',
        }
      } catch (err) {
        voiceDebugLogger.logToolCallEnd(callId, null, String(err))
        setToolStatus(null)
        return { success: false, summary: '暂时没能保存联系方式。' }
      }
    }

    try {
      const response = await fetch(`${API_BASE}/api/voice/tools/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, params })
      })
      const data = await response.json()

      if (data.mapAction) {
        handleMapAction(data.mapAction)
      }

      // Create attachment from tool result
      if (data.result) {
        if (toolName === 'search_projects' && data.result.projects?.length > 0) {
          pendingAttachmentRef.current = {
            type: 'projects',
            projects: data.result.projects.map((p: any) => ({
              id: p.id,
              name: p.project_name,
              developer: p.developer,
              area: p.area,
              minPrice: p.min_price ? parseFloat(p.min_price) : undefined,
              maxPrice: p.max_price ? parseFloat(p.max_price) : undefined,
              image: p.primary_image,
              status: p.status,
              rentalYield: p.rental_yield_pct,
              priceGrowth: p.price_growth_pct,
              unitTypes: (p.unit_types_in_budget || []).map((u: any) => ({
                category: u.category,
                bedrooms: u.bedrooms,
                minPrice: u.min_price,
                maxPrice: u.max_price,
                minAreaSqft: u.min_area_sqft,
                sampleFloorPlan: u.sample_floor_plan
              }))
            }))
          }
        } else if (toolName === 'navigate_to_project' && data.result?.projectId) {
          // Show project with unit types + investment chart
          pendingAttachmentRef.current = {
            type: 'projects',
            projects: [{
              id: data.result.projectId,
              name: data.result.projectName,
              developer: data.result.developer,
              area: data.result.area || '',
              minPrice: data.result.minPrice ? parseFloat(data.result.minPrice) : undefined,
              maxPrice: data.result.maxPrice ? parseFloat(data.result.maxPrice) : undefined,
              image: data.result.image,
              status: data.result.status,
              unitTypes: (data.result.unitTypes || []).map((u: any) => ({
                category: u.category,
                bedrooms: u.bedrooms,
                minPrice: u.price,
                maxPrice: u.price,
                minAreaSqft: u.area_sqft
              }))
            }],
            investment: data.result.investment_5yr ? {
              projectName: data.result.projectName,
              purchasePrice: data.result.investment_5yr.purchase_price,
              rentalIncome5yr: data.result.investment_5yr.rental_income_5yr,
              appreciation5yr: data.result.investment_5yr.appreciation_5yr,
              totalProfit5yr: data.result.investment_5yr.total_profit_5yr,
              annualizedReturnPct: data.result.investment_5yr.annualized_return_pct,
              growthPct: data.result.investment_5yr.area_growth_pct || 0
            } : undefined
          }
          // Auto-navigate to project detail page after map fly animation
          setTimeout(() => {
            handleMapAction({ type: 'navigate', path: `/project/${data.result.projectId}` })
          }, 2500)
        } else if (toolName === 'get_area_info') {
          if (data.result.metrics) {
            // Area has direct metrics
            pendingAttachmentRef.current = {
              type: 'area_info',
              areaInfo: {
                name: data.result.metrics.area_name || params.area_name,
                rentalYield: data.result.metrics.rental_yield_pct,
                priceGrowth: data.result.metrics.price_growth_pct,
                transactionCount: data.result.metrics.sales_transaction_count,
                medianPrice: data.result.metrics.median_price_sqm
              }
            }
          } else if (data.result.nearby_benchmarks?.length > 0) {
            // No direct metrics — use best nearby benchmark as reference
            const best = data.result.nearby_benchmarks[0]
            pendingAttachmentRef.current = {
              type: 'area_info',
              areaInfo: {
                name: `${data.result.area?.name || params.area_name} (≈${best.name})`,
                rentalYield: best.rental_yield_pct ? parseFloat(best.rental_yield_pct) : undefined,
                priceGrowth: best.price_growth_pct ? parseFloat(best.price_growth_pct) : undefined,
                transactionCount: best.sales_transaction_count,
                medianPrice: best.median_price_sqm ? parseFloat(best.median_price_sqm) : undefined
              }
            }
          }
        } else if (toolName === 'compare_areas' && data.result.area1 && data.result.area2) {
          pendingAttachmentRef.current = {
            type: 'comparison',
            comparison: {
              area1: {
                name: data.result.area1.area_name,
                rentalYield: data.result.area1.rental_yield_pct,
                priceGrowth: data.result.area1.price_growth_pct,
                transactionCount: data.result.area1.sales_transaction_count
              },
              area2: {
                name: data.result.area2.area_name,
                rentalYield: data.result.area2.rental_yield_pct,
                priceGrowth: data.result.area2.price_growth_pct,
                transactionCount: data.result.area2.sales_transaction_count
              }
            }
          }
        }
      }

      voiceDebugLogger.logToolCallEnd(callId, data.result)
      // Don't clear toolStatus here — keep thinking bubble visible
      // until first assistant text arrives (cleared in handleMessage)
      return data
    } catch (err) {
      console.error('[Voice] Tool execution error:', err)
      voiceDebugLogger.logToolCallEnd(callId, null, String(err))
      setToolStatus(null) // Clear on error only
      return { success: false, error: 'Tool execution failed' }
    }
  }, [getToolDisplayName, handleMapAction])

  // Handle Gemini messages
  const handleMessage = useCallback(async (message: LiveServerMessage) => {
    // Log the gap from the user's speech to Luna's first reply token (once per turn).
    const logReplyLatency = (kind: string) => {
      if (turnReplyLoggedRef.current || !turnUserFirstTsRef.current) return
      turnReplyLoggedRef.current = true
      const now = performance.now()
      console.log(
        `[VoiceTiming] Luna reply START (${kind}) — ` +
        `${Math.round(now - turnUserLastTsRef.current)}ms after user STOPPED, ` +
        `${Math.round(now - turnUserFirstTsRef.current)}ms after user STARTED`
      )
    }
    // Session resumption: stash the latest handle (only when the server says this
    // point is resumable — not mid-tool-call/generation, which would lose state).
    if (message.sessionResumptionUpdate) {
      const u = message.sessionResumptionUpdate
      if (u.resumable && u.newHandle) resumeHandleRef.current = u.newHandle
    }
    // GoAway: the server is about to terminate this connection (session/rate limit).
    // Log it so we can SEE why drops happen; the close → auto-reconnect then resumes
    // via the handle above, so context survives.
    if (message.goAway) {
      console.warn('[Voice] GoAway — server will close soon, timeLeft:', message.goAway.timeLeft)
      voiceDebugLogger.log('GO_AWAY', { timeLeft: message.goAway.timeLeft })
    }

    if (message.serverContent) {
      const content = message.serverContent

      // Interruption
      if (content.interrupted) {
        voiceDebugLogger.logInterruption()
        playerRef.current?.stop()
        // User barged in → start a fresh caption for the new utterance
        userTurnFreshRef.current = true
        setPhase('listening')
        return
      }

      // Input transcription (user speech) — show a live caption of the user's words
      if (content.inputTranscription) {
        const text = typeof content.inputTranscription === 'string'
          ? content.inputTranscription
          : (content.inputTranscription as any).text
        if (text) {
          // First fragment after the assistant spoke = a new utterance → reset caption
          if (userTurnFreshRef.current) {
            userTextAccumRef.current = ''
            userTurnFreshRef.current = false
            turnUserFirstTsRef.current = performance.now()
            turnReplyLoggedRef.current = false
            console.log('[VoiceTiming] user speech START')
          }
          turnUserLastTsRef.current = performance.now()
          userTextAccumRef.current += text
          setUserTranscript(userTextAccumRef.current.trim())
          voiceDebugLogger.logUserMessage(text)
        }
      }

      // Output transcription (assistant speech) — accumulate + throttled flush
      if (content.outputTranscription) {
        let text = typeof content.outputTranscription === 'string'
          ? content.outputTranscription
          : (content.outputTranscription as any).text
        if (text) {
          // Strip control characters (e.g. <ctrl46>) that Gemini sometimes outputs
          text = text.replace(/<ctrl\d+>/gi, '').replace(/[\x00-\x1F\x7F]/g, '')
          if (text.trim()) {
            logReplyLatency('text')
            // Clear thinking bubble once real response arrives
            setToolStatus(null)
            // Luna is responding → the user's turn just ended. Commit the user's
            // utterance to the transcript now (idempotent — no-op if already flushed),
            // so the saved conversation includes what the customer said.
            voiceDebugLogger.finalizeUserMessage()
            // Luna is responding → hide the user caption and show her bubble (which
            // then persists after she finishes); next user input starts a fresh caption.
            userTurnFreshRef.current = true
            setUserTranscript('')
            assistantTextAccumRef.current += text
            voiceDebugLogger.logAssistantMessage(text)
            scheduleBubbleFlush()
          }
        }
      }

      // Audio output
      if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData?.data && typeof part.inlineData.data === 'string') {
            logReplyLatency('audio')
            setPhase('speaking')
            voiceDebugLogger.logAudioChunkReceived()
            playerRef.current?.play(part.inlineData.data)
          }
        }
      }

      // Turn complete
      if (content.turnComplete) {
        // Final flush of any remaining text
        if (assistantTextAccumRef.current.trim() || pendingAttachmentRef.current) {
          flushBubble()
        }
        assistantTextAccumRef.current = ''
        pendingAttachmentRef.current = null
        setToolStatus(null) // Safety: clear thinking bubble
        setPhase('listening')
        voiceDebugLogger.finalizeAssistantMessage()
        voiceDebugLogger.log('TURN_COMPLETE')
      }
    }

    // Tool calls
    if (message.toolCall?.functionCalls) {
      logReplyLatency('tool')
      // A tool call means the user's request just ended → commit their utterance
      // (idempotent) so the transcript pairs the question with the tool/answer.
      voiceDebugLogger.finalizeUserMessage()
      voiceDebugLogger.log('TOOL_CALLS_RECEIVED', {
        count: message.toolCall.functionCalls.length
      })

      const functionResponses: Array<{
        id: string
        name: string
        response: { output: string }
      }> = []

      for (const fc of message.toolCall.functionCalls) {
        if (!fc.name) continue
        const callId = fc.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`
        console.log('[Voice] Tool call:', fc.name, 'id:', callId, 'args:', fc.args)

        try {
          const result = await executeTool(fc.name, fc.args || {}, callId)

          let detailedOutput = result.summary || 'Action completed.'

          if (fc.name === 'search_projects' && result.result?.projects?.length > 0) {
            const projectList = result.result.projects.slice(0, 6).map((p: any, i: number) => {
              let info = `${i + 1}. "${p.project_name}" [ID: ${p.id}] [STATUS: ${p.status || 'unknown'}] in ${p.area || 'Dubai'}`
              if (p.status === 'sold-out') info += ` ⚠️SOLD-OUT(已售罄,不可购买)`
              if (p.rental_yield_pct) info += ` yield: ${parseFloat(p.rental_yield_pct).toFixed(1)}%`
              if (p.payback_years) info += ` payback: ${parseFloat(p.payback_years).toFixed(0)}yr`
              if (p.investment_5yr) {
                const inv = p.investment_5yr
                info += ` 5yr_profit: ${inv.total_profit_5yr} (${inv.annualized_return_pct}%/yr)`
              }
              // Unit types in budget
              if (p.unit_types_in_budget?.length > 0) {
                const units = p.unit_types_in_budget.map((u: any) =>
                  `${u.category}(${Math.round(u.min_area_sqft)}sqft,AED${(u.min_price/1000000).toFixed(2)}M)`
                ).join(', ')
                info += ` UNITS_IN_BUDGET: ${units}`
              }
              if (p.nearest_metro) {
                info += ` METRO: ${p.nearest_metro.name}(${(p.nearest_metro.distance_m/1000).toFixed(1)}km)`
              }
              return info
            }).join('\n')
            detailedOutput = `${result.summary}\n\nPROJECT LIST (use these IDs for navigation):\n${projectList}`
          }

          if (fc.name === 'navigate_to_project' && result.result?.unitTypes?.length > 0) {
            const unitList = result.result.unitTypes.map((u: any) =>
              `${u.category}: ${Math.round(u.area_sqft)}sqft, AED${(u.price/1000000).toFixed(2)}M, ${u.bedrooms}bed/${u.bathrooms}bath`
            ).join('\n')
            detailedOutput += `\n\nAVAILABLE UNIT TYPES:\n${unitList}\n\nTell the customer which unit types fit their needs and budget.`
          }

          if (fc.name === 'navigate_to_project' && result.result?.investment_5yr) {
            const inv = result.result.investment_5yr
            detailedOutput += `\n\n5YR INVESTMENT (unit price AED${(inv.purchase_price/1000000).toFixed(2)}M): rental=${Math.round(inv.rental_income_5yr/10000)}万, appreciation=${Math.round(inv.appreciation_5yr/10000)}万, total_profit=${Math.round(inv.total_profit_5yr/10000)}万, annualized=${inv.annualized_return_pct}%/yr. An investment chart is displayed. Explain the breakdown to the customer.`
          }

          if (fc.name === 'navigate_to_project' && result.result?.nearbyPOIs?.length > 0) {
            const pois = result.result.nearbyPOIs.map((p: any) =>
              `[${p.category}] ${p.name}(${(p.distance_m/1000).toFixed(1)}km)`
            ).join(', ')
            detailedOutput += `\n\nNEARBY AMENITIES: ${pois}. Tell customer about nearby facilities — metro for transport, hospitals for healthcare, schools for families, malls for lifestyle.`
          }

          if (fc.name === 'navigate_to_project' && result.result?.nearbyLandmarks?.length > 0) {
            const landmarks = result.result.nearbyLandmarks.map((l: any) =>
              `${l.name}(${l.landmark_type}, ${(l.distance_m/1000).toFixed(1)}km)`
            ).join(', ')
            detailedOutput += `\n\nNEARBY LANDMARKS: ${landmarks}. Mention key landmarks to help customer understand the location.`
          }

          if (fc.name === 'navigate_to_project' && (result.result?.areaYieldPct || result.result?.areaGrowthPct)) {
            detailedOutput += `\n\nAREA METRICS: yield=${result.result.areaYieldPct?.toFixed(1) || 'N/A'}%, growth=${result.result.areaGrowthPct?.toFixed(1) || 'N/A'}%. Mention the area's investment performance.`
          }

          if (fc.name === 'get_area_info') {
            if (result.result?.metrics) {
              const m = result.result.metrics
              const yieldPct = m.rental_yield_pct ? parseFloat(m.rental_yield_pct).toFixed(1) : 'N/A'
              const growthPct = m.price_growth_pct ? parseFloat(m.price_growth_pct).toFixed(1) : 'N/A'
              detailedOutput = `${result.summary}\n\nMETRICS: rental_yield=${yieldPct}%, price_growth=${growthPct}%, transactions=${m.sales_transaction_count || 'N/A'}`
            }
            if (result.result?.nearby_benchmarks?.length > 0) {
              const benchmarks = result.result.nearby_benchmarks.map((b: any) =>
                `${b.name}: yield=${parseFloat(b.rental_yield_pct).toFixed(1)}%, growth=${parseFloat(b.price_growth_pct).toFixed(1)}%`
              ).join('; ')
              detailedOutput += `\n\nNEARBY BENCHMARKS: ${benchmarks}`
            }
            if (result.result?.investment_5yr) {
              const inv = result.result.investment_5yr
              detailedOutput += `\n\n5YR INVESTMENT: rental_income=${inv.rental_income_5yr}, appreciation=${inv.appreciation_5yr}, total_profit=${inv.total_profit_5yr}, annualized=${inv.annualized_return_pct}%`
            }
          }

          functionResponses.push({
            id: callId,
            name: fc.name,
            response: { output: detailedOutput }
          })
        } catch (toolError) {
          console.error('[Voice] Tool execution failed:', toolError)
          functionResponses.push({
            id: callId,
            name: fc.name,
            response: { output: 'Tool execution failed. Please try again.' }
          })
        }
      }

      if (sessionRef.current?.sendToolResponse && functionResponses.length > 0) {
        voiceDebugLogger.log('SENDING_TOOL_RESPONSE', { count: functionResponses.length })
        try {
          sessionRef.current.sendToolResponse({ functionResponses })
          voiceDebugLogger.log('TOOL_RESPONSE_SENT')
        } catch (err) {
          voiceDebugLogger.logError('TOOL_RESPONSE_ERROR', String(err))
          console.error('[Voice] Tool response error:', err)
        }
      }
    }
  }, [executeTool, scheduleBubbleFlush, flushBubble])

  // Initialize audio player
  useEffect(() => {
    const initAudio = () => {
      if (!playerRef.current) {
        playerRef.current = new AudioPlayer((speaking) => {
          lunaSpeakingRef.current = speaking
          // Only transition to listening when audio finishes and we're in speaking phase
          if (!speaking) {
            setPhase(prev => prev === 'speaking' ? 'listening' : prev)
          }
        })
        playerRef.current.prewarm?.()
      }
    }

    const handler = () => {
      initAudio()
      document.removeEventListener('click', handler)
      document.removeEventListener('touchstart', handler)
    }

    document.addEventListener('click', handler)
    document.addEventListener('touchstart', handler)
    initAudio()

    return () => {
      document.removeEventListener('click', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [])

  // Start recording helper
  const startRecording = useCallback(async () => {
    if (!sessionRef.current || recorderRef.current) return

    try {
      voiceDebugLogger.logRecordingStart()
      recorderRef.current = new AudioRecorder()
      await recorderRef.current.start((base64) => {
        // NOTE: full-duplex. Self-interruption is handled by (1) not leaking the mic
        // to the speaker and (2) browser echo cancellation — NOT by gating the mic,
        // which made the user's words + Luna's reply lag several seconds while she
        // spoke the welcome message. (lunaSpeakingRef kept for possible future use.)
        if (sessionRef.current?.sendRealtimeInput) {
          voiceDebugLogger.logAudioChunkSent()
          sessionRef.current.sendRealtimeInput({
            audio: {
              data: base64,
              mimeType: 'audio/pcm;rate=16000'
            }
          })
        }
      })
      setPhase('listening')
    } catch (e) {
      voiceDebugLogger.logError('MICROPHONE_ERROR', String(e))
      setPhase('error')
      setTimeout(() => setPhase('idle'), 3000)
    }
  }, [])

  // Store ref for delayed call after connect
  useEffect(() => {
    startRecordingRef.current = startRecording
  }, [startRecording])

  // Activate: connect + auto-start mic
  const activate = useCallback(async () => {
    if (sessionRef.current || connectingRef.current) {
      console.log('[Voice] Already connected or connecting, skipping')
      return
    }

    // Behaviour analytics: only the user-initiated open, not auto-reconnects.
    const isReconnect = reconnectAttemptsRef.current > 0
    if (!isReconnect) trackEvent('luna_open')

    connectingRef.current = true
    intentionalDisconnectRef.current = false
    reconnectAttemptsRef.current = 0
    // Keep an auto-reconnect inside the SAME debug session so a dropped WebSocket
    // doesn't split one conversation into multiple records (it used to: the drop
    // ended the session, the 1s reconnect started a fresh one). Only a real open
    // starts a new session; a reconnect resumes the existing one if it's still alive.
    if (isReconnect && voiceDebugLogger.getCurrentSession()) {
      voiceDebugLogger.log('RECONNECTED', { resuming: !!resumeHandleRef.current })
    } else {
      resumeHandleRef.current = null // fresh conversation → don't resume an old one
      voiceDebugLogger.startSession()
    }
    setPhase('connecting')

    // "Ready" chime on user-initiated open: UX feedback + warms the audio pipeline
    // so Luna's first buffer doesn't glitch on a cold context. Runs on this tap
    // gesture, so the AudioContext is allowed to resume.
    if (!isReconnect) playerRef.current?.chime?.()

    try {
      const tokenFetchStart = Date.now()
      voiceDebugLogger.log('TOKEN_FETCH_START', { language: currentLanguage })

      const tokenResponse = await fetch(`${API_BASE}/api/voice/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: currentLanguage })
      })
      const tokenData = await tokenResponse.json()

      if (!tokenData.token) {
        throw new Error('Failed to get token')
      }

      voiceDebugLogger.logTokenFetch(tokenFetchStart)
      systemInstructionRef.current = tokenData.systemInstruction

      const connectStart = Date.now()
      voiceDebugLogger.log('WEBSOCKET_CONNECT_START')

      const ai = new GoogleGenAI({
        apiKey: tokenData.token,
        httpOptions: { apiVersion: 'v1alpha' }
      })

      const session = await ai.live.connect({
        model: GEMINI_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Aoede' }
            }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // VAD tuning — the START and END sides are tuned INDEPENDENTLY:
          //   END side (endOfSpeechSensitivity + silenceDurationMs) controls how fast
          //   Luna replies AFTER the user stops → kept AGGRESSIVE (HIGH + 350ms) so
          //   she answers ~instantly. (The old LOW + 800ms here caused 10s+ latency.)
          //   START side (startOfSpeechSensitivity + prefixPaddingMs) controls how
          //   eagerly noise/breath is treated as a barge-in → kept CONSERVATIVE
          //   (LOW + 400ms) so background noise no longer interrupts Luna mid-sentence
          //   and clips her endings. (HIGH + 200ms here was cutting her off.)
          // If endings still get clipped, raise prefixPaddingMs further (debounce);
          // if replies feel slow again, lower silenceDurationMs — don't cross-tune.
          realtimeInputConfig: {
            automaticActivityDetection: {
              // HIGH start = Gemini registers the user is talking FAST (this was the
              // value that actually worked; LOW made it miss speech start entirely →
              // "说半天没反应"). prefixPaddingMs is the debounce against false barge-ins
              // (raise it, not the sensitivity, if endings get clipped on speaker).
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
              prefixPaddingMs: 300,
              silenceDurationMs: 350,
            },
          },
          systemInstruction: {
            parts: [{ text: systemInstructionRef.current }]
          },
          tools: voiceTools as any,
          // Survive WebSocket drops WITH full context: the server sends resumption
          // handles (captured in handleMessage); on reconnect we pass the latest so
          // Luna remembers the conversation instead of starting over ("找不到…").
          // contextWindowCompression keeps long sessions from hitting the token cap.
          sessionResumption: { handle: resumeHandleRef.current || undefined },
          contextWindowCompression: { slidingWindow: {} },
        },
        callbacks: {
          onopen: () => {
            console.log('[Voice] Connected!')
            connectingRef.current = false
            reconnectAttemptsRef.current = 0
            voiceDebugLogger.logConnected(connectStart)

            voiceDebugLogger.log('AUTO_START_RECORDING')
            setTimeout(() => {
              startRecordingRef.current?.()
            }, 100)
          },
          onmessage: handleMessage,
          onerror: (e) => {
            console.error('[Voice] Error:', e)
            connectingRef.current = false
            voiceDebugLogger.logError('CONNECTION_ERROR', String(e))
            setPhase('error')
            setTimeout(() => setPhase('idle'), 3000)
          },
          onclose: (e?: CloseEvent) => {
            // Capture WHY it closed (code/reason) so drops are diagnosable, not a mystery.
            console.log('[Voice] Connection closed', e?.code, e?.reason, 'wasClean:', e?.wasClean)
            voiceDebugLogger.log('CONNECTION_CLOSED', {
              code: e?.code, reason: e?.reason, wasClean: e?.wasClean
            })

            if (recorderRef.current) {
              recorderRef.current.stop()
              recorderRef.current = null
            }

            connectingRef.current = false
            sessionRef.current = null

            // Auto-reconnect if not intentional
            if (!intentionalDisconnectRef.current &&
                reconnectAttemptsRef.current < AUTO_RECONNECT_MAX) {
              // Involuntary drop → keep the debug session OPEN so the whole
              // conversation stays in one record across the reconnect.
              voiceDebugLogger.log('RECONNECT_PENDING')
              const attempt = reconnectAttemptsRef.current
              const delayMs = AUTO_RECONNECT_BASE_MS * Math.pow(2, attempt)
              console.log(`[Voice] Auto-reconnect attempt ${attempt + 1}/${AUTO_RECONNECT_MAX} in ${delayMs}ms`)
              reconnectAttemptsRef.current = attempt + 1
              setPhase('connecting')
              reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null
                activate()
              }, delayMs)
            } else {
              // Real end (reconnect exhausted or intentional) → persist now.
              voiceDebugLogger.endSession()
              setPhase('idle')
            }
          }
        }
      })

      sessionRef.current = session
    } catch (err) {
      console.error('[Voice] Connect error:', err)
      connectingRef.current = false
      voiceDebugLogger.logError('CONNECT_ERROR', String(err))

      // Auto-reconnect on connect failure too
      if (!intentionalDisconnectRef.current &&
          reconnectAttemptsRef.current < AUTO_RECONNECT_MAX) {
        const attempt = reconnectAttemptsRef.current
        const delayMs = AUTO_RECONNECT_BASE_MS * Math.pow(2, attempt)
        reconnectAttemptsRef.current = attempt + 1
        setPhase('connecting')
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          activate()
        }, delayMs)
      } else {
        setPhase('error')
        setTimeout(() => setPhase('idle'), 3000)
        voiceDebugLogger.endSession()
      }
    }
  }, [currentLanguage, handleMessage])

  // Deactivate: full cleanup
  const deactivate = useCallback(() => {
    trackEvent('luna_close')  // Behaviour analytics: user-initiated close.
    intentionalDisconnectRef.current = true
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    recorderRef.current?.stop()
    recorderRef.current = null
    playerRef.current?.stop()
    sessionRef.current?.close?.()
    sessionRef.current = null
    connectingRef.current = false
    assistantTextAccumRef.current = ''
    pendingAttachmentRef.current = null
    stickyAttachmentRef.current = null
    reconnectAttemptsRef.current = 0
    userTextAccumRef.current = ''
    userTurnFreshRef.current = true
    setPhase('idle')
    setLatestBubble(null)
    setToolStatus(null)
    setUserTranscript('')
    voiceDebugLogger.endSession()
  }, [])

  // Persist the session if the tab is closed/backgrounded mid-conversation.
  // Needed because auto-reconnect no longer ends the session on every drop — a
  // close that's really a page unload would otherwise lose the record. endSession()
  // persists via navigator.sendBeacon, which is built for exactly this moment.
  useEffect(() => {
    const onPageHide = () => {
      if (!voiceDebugLogger.getCurrentSession()) return
      intentionalDisconnectRef.current = true // don't try to reconnect during unload
      voiceDebugLogger.endSession()
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recorderRef.current?.stop()
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    }
  }, [])

  return (
    <VoiceAssistantContext.Provider value={{
      phase,
      latestBubble,
      toolStatus,
      userTranscript,
      activate,
      deactivate,
      registerMapActionHandler,
      unregisterMapActionHandler,
      navigateToProject,
      hidden,
      setHidden
    }}>
      {children}
    </VoiceAssistantContext.Provider>
  )
}

export function useVoiceAssistantContext() {
  const context = useContext(VoiceAssistantContext)
  if (!context) {
    throw new Error('useVoiceAssistantContext must be used within VoiceAssistantProvider')
  }
  return context
}
