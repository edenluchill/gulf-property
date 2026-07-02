/**
 * Voice Assistant Button — Vertical pill docked to right edge
 *
 * - Pill: right edge, rounded-l, vertical layout (name + face + status)
 * - Bubble: flex-centered to the LEFT of the pill, grows upward if tall
 * - ThinkingBubble: soft indigo tint, animated dots, shown during tool execution
 * - ResponseBubble: soft blue-white glass, distinct from plain white map BG
 * - No auto-fade: last bubble persists until deactivate
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, MapPin, Building2, ExternalLink, Search, Globe, BarChart3, Compass, Keyboard, X, Send } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useVoiceAssistantContext } from '../../contexts/VoiceAssistantContext'
import { VoicePhase, ProjectCard, AreaInfoCard, BubbleContent, Investment5yr, MessageAttachment } from '../../hooks/voice-assistant/types'
import { cn } from '../../lib/utils'

// Text mode is built (keyboard icon + panel + backend /api/voice/text) but the
// backend Gemini tool-understanding is currently ERRATIC from the production
// server's region (works 12/12 locally, ~1/6 on the server — same key/model).
// Keep the entry hidden until that's resolved, so customers don't get a text
// Luna that greets instead of acting. Flip to true once reliable.
const TEXT_MODE_ENABLED = false

// ─── Helpers ───

function formatPrice(price: number | undefined): string {
  if (!price) return ''
  if (price >= 1000000) return `${(price / 1000000).toFixed(1)}M`
  if (price >= 1000) return `${(price / 1000).toFixed(0)}K`
  return price.toString()
}

/** Pick an icon for the tool status */
function getToolIcon(toolStatus: string): typeof Search {
  if (toolStatus.includes('搜索') || toolStatus.includes('Search')) return Search
  if (toolStatus.includes('定位') || toolStatus.includes('Locat')) return Compass
  if (toolStatus.includes('区域') || toolStatus.includes('area') || toolStatus.includes('对比') || toolStatus.includes('Compar')) return Globe
  if (toolStatus.includes('项目') || toolStatus.includes('project') || toolStatus.includes('Open')) return BarChart3
  return Search
}

// ─── Luna Face SVG ───

function LunaFace({ phase, size = 36 }: { phase: VoicePhase; size?: number }) {
  const skin = '#FFE0BD'
  const cheek = '#FFB6C1'
  const eye = '#3B3B3B'

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" fill={skin} />
      <path d="M4 22C4 12 13 4 24 4C35 4 44 12 44 22C44 22 40 14 24 14C8 14 4 22 4 22Z" fill="#5B4A3F" />
      <ellipse cx="7" cy="24" rx="4" ry="6" fill="#5B4A3F" />
      <ellipse cx="41" cy="24" rx="4" ry="6" fill="#5B4A3F" />
      <circle cx="13" cy="30" r="4" fill={cheek} opacity="0.35" />
      <circle cx="35" cy="30" r="4" fill={cheek} opacity="0.35" />

      {/* Eyes */}
      {phase === 'idle' && (<>
        <circle cx="17" cy="24" r="3" fill={eye} /><circle cx="31" cy="24" r="3" fill={eye} />
        <circle cx="18.2" cy="22.8" r="1.2" fill="white" /><circle cx="32.2" cy="22.8" r="1.2" fill="white" />
      </>)}
      {phase === 'connecting' && (<>
        <path d="M14 24.5C14 24.5 16 26 20 24.5" stroke={eye} strokeWidth="2" strokeLinecap="round" />
        <path d="M28 24.5C28 24.5 30 26 34 24.5" stroke={eye} strokeWidth="2" strokeLinecap="round" />
      </>)}
      {phase === 'listening' && (<>
        <circle cx="17" cy="23.5" r="3.5" fill={eye} /><circle cx="31" cy="23.5" r="3.5" fill={eye} />
        <circle cx="18.5" cy="22" r="1.5" fill="white" /><circle cx="32.5" cy="22" r="1.5" fill="white" />
        <circle cx="16" cy="25" r="0.6" fill="white" /><circle cx="30" cy="25" r="0.6" fill="white" />
      </>)}
      {phase === 'processing' && (<>
        <circle cx="17" cy="22" r="3" fill={eye} /><circle cx="31" cy="22" r="3" fill={eye} />
        <circle cx="18" cy="20.8" r="1.2" fill="white" /><circle cx="32" cy="20.8" r="1.2" fill="white" />
      </>)}
      {phase === 'speaking' && (<>
        <path d="M14 24C14 24 17 21 20 24" stroke={eye} strokeWidth="2.2" strokeLinecap="round" />
        <path d="M28 24C28 24 31 21 34 24" stroke={eye} strokeWidth="2.2" strokeLinecap="round" />
      </>)}
      {phase === 'error' && (<>
        <circle cx="17" cy="24" r="2.5" fill={eye} /><circle cx="31" cy="24" r="2.5" fill={eye} />
        <circle cx="18" cy="23" r="1" fill="white" /><circle cx="32" cy="23" r="1" fill="white" />
      </>)}

      {/* Mouth */}
      {(phase === 'idle' || phase === 'listening') && (
        <path d="M18 32C18 32 21 36 24 36C27 36 30 32 30 32" stroke={eye} strokeWidth="1.8" strokeLinecap="round" fill="none" />
      )}
      {phase === 'connecting' && (
        <path d="M20 33C20 33 22 35 24 35C26 35 28 33 28 33" stroke={eye} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      )}
      {phase === 'processing' && <ellipse cx="24" cy="34" rx="2.5" ry="2" fill={eye} />}
      {phase === 'speaking' && (
        <path d="M18 31C18 31 21 37 24 37C27 37 30 31 30 31" stroke={eye} strokeWidth="1.5" strokeLinecap="round" fill="#FF8B8B" />
      )}
      {phase === 'error' && (
        <path d="M19 34C20 33 22 34 24 33C26 34 28 33 29 34" stroke={eye} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      )}
    </svg>
  )
}

// ─── Thinking Bubble (shown during tool execution) ───

function ThinkingBubble({ toolStatus }: { toolStatus: string }) {
  const Icon = getToolIcon(toolStatus)

  return (
    <motion.div
      initial={{ opacity: 0, x: 24, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
      className="w-64 max-w-[calc(100vw-6rem)]"
    >
      <div className="relative rounded-2xl bg-gradient-to-br from-indigo-50 to-blue-50/80 px-4 py-3 shadow-lg shadow-indigo-100/40 backdrop-blur-xl border border-indigo-100/60">
        {/* Subtle shimmer */}
        <motion.div
          className="absolute inset-0 rounded-2xl overflow-hidden"
        >
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
          />
        </motion.div>

        {/* Tail arrow */}
        <div className="absolute bottom-7 -right-[6px] w-3 h-3 rotate-45 bg-blue-50/80 border-t border-r border-indigo-100/60" />

        {/* Content */}
        <div className="relative flex items-center gap-2.5">
          {/* Animated icon */}
          <motion.div
            animate={{ rotate: [0, 360] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="flex-shrink-0"
          >
            <Icon className="h-4 w-4 text-indigo-400" />
          </motion.div>

          {/* Status text */}
          <span className="text-indigo-600 text-[13px] font-medium">{toolStatus}</span>

          {/* Animated dots */}
          <div className="flex gap-[3px] ml-auto">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="w-[5px] h-[5px] rounded-full bg-indigo-300"
                animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Compact Project Card ───

function CompactProjectCard({ project, onNavigate }: { project: ProjectCard; onNavigate: (id: string) => void }) {
  return (
    <button
      onClick={() => onNavigate(project.id)}
      className="w-full rounded-xl bg-white/70 p-2 text-left hover:bg-white/90 transition-all group"
    >
      <div className="flex items-center gap-2.5">
        <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
          {project.image ? (
            <img src={project.image} alt={project.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center"><Building2 className="h-4 w-4 text-gray-300" /></div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-gray-900">{project.name}</span>
            {project.rentalYield != null && (
              <span className="flex-shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                {parseFloat(String(project.rentalYield)).toFixed(1)}%
              </span>
            )}
          </div>
          <p className="truncate text-[10px] text-gray-400">
            {project.developer}{project.area ? ` · ${project.area}` : ''}
            {(project.minPrice || project.maxPrice) && (
              <> · <span className="text-gray-500 font-medium">AED {formatPrice(project.minPrice)}{project.maxPrice && project.minPrice !== project.maxPrice ? `-${formatPrice(project.maxPrice)}` : ''}</span></>
            )}
          </p>
        </div>
        <ExternalLink className="h-3 w-3 flex-shrink-0 text-gray-300 group-hover:text-gray-500 transition-colors" />
      </div>
      {/* Unit types in budget */}
      {project.unitTypes && project.unitTypes.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5 pl-[50px]">
          {project.unitTypes.slice(0, 4).map((u) => (
            <span key={u.category} className="inline-flex items-center gap-0.5 rounded-md bg-blue-50/80 px-1.5 py-0.5 text-[9px] text-blue-700">
              <span className="font-semibold">{u.category}</span>
              <span className="text-blue-400">·</span>
              <span>{Math.round(u.minAreaSqft)}ft²</span>
              <span className="text-blue-400">·</span>
              <span className="font-medium">{formatPrice(u.minPrice)}</span>
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

// ─── Compact Area Info Card ───

function CompactAreaCard({ areaInfo, t }: { areaInfo: AreaInfoCard; t: TFunction<'components'> }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-slate-50/80 to-blue-50/60 p-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <MapPin className="h-3 w-3 text-blue-500" />
        <span className="text-xs font-medium text-gray-900">{areaInfo.name}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        {areaInfo.rentalYield != null && (
          <div className="rounded-lg bg-white/70 px-1.5 py-1">
            <span className="text-gray-400">{t('voice.metric.yield')}</span>
            <span className="ml-1 font-semibold text-emerald-600">{parseFloat(String(areaInfo.rentalYield)).toFixed(1)}%</span>
          </div>
        )}
        {areaInfo.priceGrowth != null && (
          <div className="rounded-lg bg-white/70 px-1.5 py-1">
            <span className="text-gray-400">{t('voice.metric.growth')}</span>
            <span className={cn('ml-1 font-semibold', parseFloat(String(areaInfo.priceGrowth)) >= 0 ? 'text-emerald-600' : 'text-red-500')}>
              {parseFloat(String(areaInfo.priceGrowth)) >= 0 ? '+' : ''}{parseFloat(String(areaInfo.priceGrowth)).toFixed(1)}%
            </span>
          </div>
        )}
        {areaInfo.transactionCount != null && (
          <div className="rounded-lg bg-white/70 px-1.5 py-1">
            <span className="text-gray-400">{t('voice.metric.txns')}</span>
            <span className="ml-1 font-semibold text-gray-700">{Number(areaInfo.transactionCount).toLocaleString()}</span>
          </div>
        )}
        {areaInfo.medianPrice != null && (
          <div className="rounded-lg bg-white/70 px-1.5 py-1">
            <span className="text-gray-400">{t('voice.metric.pricePerSqm')}</span>
            <span className="ml-1 font-semibold text-gray-700">{Number(areaInfo.medianPrice).toLocaleString()}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 5-Year Investment Chart (pure SVG) ───

function InvestmentChart({ inv, t }: { inv: Investment5yr; t: TFunction<'components'> }) {
  const price = inv.purchasePrice
  const growth = inv.growthPct / 100
  const annualRent = inv.rentalIncome5yr / 5

  const years = [0, 1, 2, 3, 4, 5]
  const data = years.map(y => ({
    year: y,
    value: price * Math.pow(1 + growth, y) + annualRent * y,
    appreciation: price * Math.pow(1 + growth, y) - price,
    rental: annualRent * y
  }))

  const maxVal = data[5].value
  const minVal = price * 0.95

  const W = 240, H = 100, padL = 4, padR = 4, padT = 8, padB = 16
  const cW = W - padL - padR
  const cH = H - padT - padB

  const x = (yr: number) => padL + (yr / 5) * cW
  const y = (val: number) => padT + cH - ((val - minVal) / (maxVal - minVal)) * cH

  const linePath = data.map((d, i) =>
    `${i === 0 ? 'M' : 'L'}${x(d.year).toFixed(1)},${y(d.value).toFixed(1)}`
  ).join(' ')

  const areaPath = `${linePath} L${x(5).toFixed(1)},${y(price).toFixed(1)} L${x(0).toFixed(1)},${y(price).toFixed(1)} Z`

  const formatM = (v: number) => `${(v / 1000000).toFixed(1)}M`
  const totalReturn = inv.totalProfit5yr

  return (
    <div className="rounded-xl bg-gradient-to-br from-emerald-50/80 to-blue-50/60 p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium text-gray-500">
          {t('voice.chart.projection')}
        </span>
        <span className="text-[10px] font-bold text-emerald-600">
          +{formatM(totalReturn)} ({inv.annualizedReturnPct}%{t('voice.chart.perYear')})
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }}>
        <defs>
          <linearGradient id="inv-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <line
          x1={padL} y1={y(price)} x2={W - padR} y2={y(price)}
          stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="3,3"
        />

        <path d={areaPath} fill="url(#inv-grad)" />
        <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {[0, 5].map(yr => {
          const d = data[yr]
          return (
            <circle key={yr} cx={x(yr)} cy={y(yr === 0 ? price : d.value)} r="2.5"
              fill={yr === 0 ? '#94a3b8' : '#10b981'} stroke="white" strokeWidth="1" />
          )
        })}

        {[0, 1, 2, 3, 4, 5].map(yr => (
          <text key={yr} x={x(yr)} y={H - 2} textAnchor="middle"
            className="text-[8px] fill-gray-400" style={{ fontSize: 8 }}>
            {t('voice.chart.yearLabel', { n: yr })}
          </text>
        ))}

        <text x={x(5) - 2} y={y(data[5].value) - 5} textAnchor="end"
          className="text-[8px] fill-emerald-600 font-semibold" style={{ fontSize: 8, fontWeight: 600 }}>
          {formatM(data[5].value)}
        </text>

        <text x={x(0) + 2} y={y(price) - 5} textAnchor="start"
          className="text-[8px] fill-gray-400" style={{ fontSize: 8 }}>
          {formatM(price)}
        </text>
      </svg>

      <div className="flex gap-2 mt-0.5">
        {inv.rentalIncome5yr > 0 && (
          <div className="flex items-center gap-1 text-[9px] text-gray-500">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            {t('voice.chart.rent')} {formatM(inv.rentalIncome5yr)}
          </div>
        )}
        {inv.appreciation5yr > 0 && (
          <div className="flex items-center gap-1 text-[9px] text-gray-500">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {t('voice.chart.growth')} {formatM(inv.appreciation5yr)}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Bubble Attachment (project cards / area info / comparison / chart) ───
// Shared by the voice response bubble AND the text-mode panel so both render cards
// identically from the same MessageAttachment.

function BubbleAttachmentView({
  attachment,
  onNavigateProject,
  t
}: {
  attachment: MessageAttachment
  onNavigateProject: (id: string) => void
  t: TFunction<'components'>
}) {
  return (
    <>
      {/* Project cards + investment chart */}
      {attachment.type === 'projects' && attachment.projects && (
        <div className="space-y-1.5 mt-2">
          {attachment.projects.slice(0, 2).map((project) => (
            <CompactProjectCard key={project.id} project={project} onNavigate={onNavigateProject} />
          ))}
          {attachment.projects.length > 2 && (
            <p className="text-center text-[10px] text-gray-400 pt-0.5">
              {t('voice.moreProjects', { count: attachment.projects.length - 2 })}
            </p>
          )}
          {attachment.projects.length === 1 && attachment.investment && (
            <InvestmentChart inv={attachment.investment} t={t} />
          )}
        </div>
      )}

      {/* Area info */}
      {attachment.type === 'area_info' && attachment.areaInfo && (
        <div className="mt-2"><CompactAreaCard areaInfo={attachment.areaInfo} t={t} /></div>
      )}

      {/* Comparison */}
      {attachment.type === 'comparison' && attachment.comparison && (
        <div className="space-y-1.5 mt-2">
          <CompactAreaCard areaInfo={attachment.comparison.area1} t={t} />
          <div className="flex items-center justify-center">
            <span className="text-[10px] font-medium text-gray-300 tracking-wider">VS</span>
          </div>
          <CompactAreaCard areaInfo={attachment.comparison.area2} t={t} />
        </div>
      )}

      {/* Investment chart */}
      {attachment.type === 'investment' && attachment.investment && (
        <div className="mt-2"><InvestmentChart inv={attachment.investment} t={t} /></div>
      )}
    </>
  )
}

// ─── Response Bubble (soft blue-white glass, distinct from plain white BG) ───

function LunaBubble({
  bubble,
  onNavigateProject,
  t
}: {
  bubble: BubbleContent
  onNavigateProject: (id: string) => void
  t: TFunction<'components'>
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
      className="w-64 md:w-72 max-w-[calc(100vw-5rem)] max-h-[42vh] md:max-h-[calc(100vh-10rem)] overflow-x-hidden overflow-y-auto"
    >
      <div className="relative rounded-2xl bg-gradient-to-br from-[#f0f4ff] to-white px-4 py-3 text-sm shadow-xl shadow-blue-900/[0.06] backdrop-blur-xl border border-blue-100/50 ring-1 ring-blue-50">
        {/* Tail arrow */}
        <div className="absolute bottom-7 -right-[6px] w-3 h-3 rotate-45 bg-[#f5f7ff] border-t border-r border-blue-100/50" />

        {/* Text */}
        {bubble.text && (
          <p className="text-gray-800 leading-relaxed text-[13px]">{bubble.text}</p>
        )}

        {bubble.attachment && (
          <BubbleAttachmentView attachment={bubble.attachment} onNavigateProject={onNavigateProject} t={t} />
        )}
      </div>
    </motion.div>
  )
}

// ─── Luna Text Panel (方案 B: typed input, audio-free) ───
// Shows ONLY the last exchange (user msg + Luna reply). Reuses the same cards.

function LunaTextPanel({
  onNavigateProject,
  t
}: {
  onNavigateProject: (id: string) => void
  t: TFunction<'components'>
}) {
  const { lastExchange, sendText, closeText, textPending } = useVoiceAssistantContext()
  const [input, setInput] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow the textarea (capped) as the user types.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }, [input])

  const handleSend = useCallback(() => {
    const v = input.trim()
    if (!v || textPending) return
    setInput('')
    sendText(v)
  }, [input, textPending, sendText])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
      className="w-72 max-w-[calc(100vw-5rem)]"
    >
      <div className="relative rounded-2xl bg-white/90 shadow-2xl shadow-blue-900/10 backdrop-blur-xl border border-blue-100/60 ring-1 ring-blue-50 overflow-hidden">
        {/* Tail arrow */}
        <div className="absolute bottom-7 -right-[6px] w-3 h-3 rotate-45 bg-white/90 border-t border-r border-blue-100/60" />

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-blue-50">
          <div className="flex items-center gap-1.5">
            <LunaFace phase="idle" size={20} />
            <span className="text-xs font-semibold text-slate-700">Luna</span>
          </div>
          <button
            onClick={closeText}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Last exchange (only 2 bubbles) */}
        <div className="px-3 py-2.5 space-y-2 max-h-[46vh] md:max-h-[calc(100vh-14rem)] overflow-y-auto">
          {lastExchange ? (
            <>
              {/* User message (right, teal) */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-600 px-3 py-1.5 text-[13px] leading-snug text-white">
                  {lastExchange.user}
                </div>
              </div>

              {/* Luna reply (left) or typing indicator */}
              {lastExchange.bubble ? (
                <div className="flex justify-start">
                  <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-gradient-to-br from-[#f0f4ff] to-white px-3 py-2 border border-blue-100/50">
                    {lastExchange.bubble.text && (
                      <p className="text-gray-800 leading-relaxed text-[13px]">{lastExchange.bubble.text}</p>
                    )}
                    {lastExchange.bubble.attachment && (
                      <BubbleAttachmentView attachment={lastExchange.bubble.attachment} onNavigateProject={onNavigateProject} t={t} />
                    )}
                  </div>
                </div>
              ) : textPending ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm bg-gradient-to-br from-[#f0f4ff] to-white px-3 py-2 border border-blue-100/50">
                    <div className="flex gap-[3px]">
                      {[0, 1, 2].map(i => (
                        <motion.div
                          key={i}
                          className="w-[5px] h-[5px] rounded-full bg-indigo-300"
                          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-center text-[12px] text-gray-400 py-3">
              {t('voice.text.placeholder', { defaultValue: 'Type to ask Luna anything about Dubai property' })}
            </p>
          )}
        </div>

        {/* Composer */}
        <div className="flex items-end gap-1.5 px-2.5 py-2 border-t border-blue-50">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={t('voice.text.inputPlaceholder', { defaultValue: '输入你的问题…' })}
            className="flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none max-h-[120px]"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || textPending}
            className={cn(
              'flex-shrink-0 rounded-full p-1.5 transition-colors',
              input.trim() && !textPending
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-gray-100 text-gray-300'
            )}
            aria-label="Send"
          >
            {textPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Status text ───

function getStatusText(phase: VoicePhase, t: TFunction<'components'>, toolStatus: string | null): string | null {
  if (toolStatus) return t('voice.status.thinking')
  switch (phase) {
    case 'listening': return t('voice.status.listening')
    case 'speaking': return t('voice.status.speaking')
    case 'connecting': return t('voice.status.connecting')
    case 'processing': return t('voice.status.thinking')
    default: return null
  }
}

// ─── Main Export ───

export function VoiceAssistantButton({ className }: { className?: string }) {
  const { t } = useTranslation('components')
  const {
    phase,
    latestBubble,
    toolStatus,
    userTranscript,
    activate,
    deactivate,
    navigateToProject,
    textOpen,
    openText,
    hidden
  } = useVoiceAssistantContext()

  // Keyboard icon → open text mode. stopPropagation so it never triggers the voice tap.
  const handleKeyboard = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    openText()
  }, [openText])

  const isActive = phase !== 'idle' && phase !== 'error'

  const handleTap = useCallback(() => {
    if (phase === 'idle' || phase === 'error') {
      activate()
    } else {
      deactivate()
    }
  }, [phase, activate, deactivate])

  const statusText = getStatusText(phase, t, toolStatus)

  // Show thinking bubble during tool calls, response bubble otherwise
  const showThinkingBubble = !!toolStatus
  const showResponseBubble = !toolStatus && !!latestBubble
  // Live user-speech caption: shown while the user is speaking (before Luna replies)
  const showUserCaption = !!userTranscript && !showThinkingBubble &&
    (phase === 'listening' || phase === 'processing')

  // Hidden during a collab live tour (the in-session UI replaces it).
  if (hidden) return null

  return (
    <div className={cn(
      'fixed bottom-20 right-0 z-50 md:bottom-6',
      className
    )}>
      {/* Text-mode panel: absolutely positioned left of pill (independent of voice) */}
      <AnimatePresence>
        {TEXT_MODE_ENABLED && textOpen && (
          <div key="text-panel" className="absolute bottom-0 right-[56px]">
            <LunaTextPanel onNavigateProject={navigateToProject} t={t} />
          </div>
        )}
      </AnimatePresence>

      {/* Bubble area: absolutely positioned left of pill, bottom-aligned */}
      <AnimatePresence mode="wait">
        {!textOpen && showThinkingBubble && (
          <div key="thinking-bubble" className="absolute bottom-0 right-[56px]">
            <ThinkingBubble toolStatus={toolStatus} />
          </div>
        )}
        {!textOpen && showUserCaption && (
          <motion.div
            key="user-caption"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className="absolute bottom-0 right-[56px] w-56 md:w-64 max-w-[calc(100vw-5rem)]"
          >
            <div className="rounded-2xl bg-emerald-600/95 px-3.5 py-2 text-[13px] leading-snug text-white shadow-xl backdrop-blur-xl">
              {userTranscript}
            </div>
          </motion.div>
        )}
        {!textOpen && showResponseBubble && !showUserCaption && (
          <div key="response-bubble" className="absolute bottom-0 right-[56px]">
            <LunaBubble
              bubble={latestBubble}
              onNavigateProject={navigateToProject}
              t={t}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Pill button: tinted glass per state */}
      <motion.button
        onClick={handleTap}
        disabled={phase === 'connecting'}
        whileTap={{ scale: 0.95 }}
        className={cn(
          'relative flex flex-col items-center gap-1 overflow-hidden flex-shrink-0',
          'rounded-l-2xl backdrop-blur-xl',
          'w-[52px] transition-all duration-300',
          isActive ? 'py-2.5 px-1.5' : 'py-3 px-1.5',
          phase === 'idle' && 'bg-gradient-to-b from-slate-200/90 to-slate-100/90 shadow-md border border-slate-300/50 hover:from-slate-200 hover:to-slate-100 hover:shadow-lg',
          phase === 'connecting' && 'bg-gradient-to-b from-slate-200/80 to-slate-100/80 shadow-md border border-slate-300/50',
          phase === 'listening' && 'bg-gradient-to-b from-emerald-200/80 to-emerald-100/80 shadow-lg shadow-emerald-200/30 border border-emerald-300/50',
          phase === 'processing' && 'bg-gradient-to-b from-indigo-200/80 to-blue-100/80 shadow-lg shadow-indigo-200/30 border border-indigo-300/50',
          phase === 'speaking' && 'bg-gradient-to-b from-violet-200/80 to-purple-100/80 shadow-lg shadow-violet-200/30 border border-violet-300/50',
          phase === 'error' && 'bg-gradient-to-b from-red-200/80 to-red-100/80 shadow-md border border-red-300/50',
        )}
      >
        {/* Listening: emerald glow pulse */}
        {phase === 'listening' && (
          <motion.div
            className="absolute inset-0 rounded-l-2xl bg-emerald-200/30"
            animate={{ opacity: [0.2, 0.5, 0.2] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}
        {/* Speaking: violet shimmer sweep */}
        {phase === 'speaking' && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-b from-transparent via-violet-200/30 to-transparent"
            animate={{ y: ['-100%', '100%'] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
          />
        )}
        {/* Processing: indigo pulse */}
        {phase === 'processing' && (
          <motion.div
            className="absolute inset-0 rounded-l-2xl bg-indigo-200/25"
            animate={{ opacity: [0.15, 0.4, 0.15] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        )}
        {/* Recording indicator dot */}
        {phase === 'listening' && (
          <div className="absolute top-1.5 right-1.5 z-20">
            <div className="h-2 w-2 rounded-full bg-red-400">
              <motion.div
                className="absolute inset-0 rounded-full bg-red-400"
                animate={{ scale: [1, 2], opacity: [0.6, 0] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
            </div>
          </div>
        )}

        <span className={cn(
          'relative z-10 text-[9px] font-semibold tracking-wide uppercase',
          phase === 'listening' && 'text-emerald-700',
          phase === 'processing' && 'text-indigo-600',
          phase === 'speaking' && 'text-violet-700',
          phase === 'error' && 'text-red-600',
          (phase === 'idle' || phase === 'connecting') && 'text-slate-600',
        )}>Luna</span>

        <motion.div
          className="relative z-10"
          animate={
            phase === 'speaking' ? { y: [0, -1.5, 0] }
              : phase === 'listening' ? { scale: [1, 1.05, 1] }
              : {}
          }
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          {phase === 'connecting' ? (
            <div className="flex items-center justify-center w-9 h-9">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
            </div>
          ) : (
            <LunaFace phase={phase} size={36} />
          )}
        </motion.div>

        <AnimatePresence>
          {statusText && (
            <motion.span
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className={cn(
                'relative z-10 text-[8px] font-medium whitespace-nowrap overflow-hidden',
                phase === 'listening' && 'text-emerald-600',
                phase === 'processing' && 'text-indigo-500',
                phase === 'speaking' && 'text-violet-600',
                phase === 'error' && 'text-red-500',
                (phase === 'idle' || phase === 'connecting') && 'text-slate-500',
              )}
            >
              {statusText}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Keyboard mini-button: opens text mode. stopPropagation → never triggers voice. */}
      {TEXT_MODE_ENABLED && (
      <button
        onClick={handleKeyboard}
        className={cn(
          'absolute -top-2 left-0 z-20 flex h-6 w-6 items-center justify-center rounded-full',
          'bg-white/95 text-slate-500 shadow-md border border-slate-200/70',
          'hover:text-slate-700 hover:shadow-lg transition-all',
          textOpen && 'bg-emerald-600 text-white border-emerald-500'
        )}
        aria-label={t('voice.text.open', { defaultValue: 'Type to Luna' })}
      >
        <Keyboard className="h-3.5 w-3.5" />
      </button>
      )}

    </div>
  )
}
