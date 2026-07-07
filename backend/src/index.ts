// ⚠️ CRITICAL: Load dotenv FIRST before any other imports
// This ensures environment variables are available when modules initialize
import dotenv from 'dotenv'
dotenv.config()

import express, { Application, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { createResidentialProjectsRouter } from './routes/residential-projects'
import { createCompareRouter } from './routes/compare'
import langgraphRouter from './routes/langgraph-processor'
import langgraphProgressRouter from './routes/langgraph-progress'
import langgraphValidateRouter from './routes/langgraph-validate'
import dubaiAreasLandmarksRouter from './routes/dubai-areas-landmarks'
import dubaiPoisRouter from './routes/dubai-pois'
import uploadRouter from './routes/upload'
import r2UploadRouter from './routes/r2-upload'
import tasksRouter from './routes/tasks'
import adminTasksRouter from './routes/admin-tasks'
import dubaiTransportRouter from './routes/dubai-transport'
import customRoutesRouter from './routes/custom-routes'
import geocodeRouter from './routes/geocode'
import voiceChatRouter, { initVoiceChatWebSocket } from './routes/voice-chat'
import collabRouter, { initCollabWebSocket } from './routes/collab'  // 实时协作带看 (isolated; see docs/luna-collaborative-tour-spec.md)
import voiceRtcRouter from './routes/voice-rtc'  // Agora 应用内语音 token + 用量额度
import agentsRouter from './routes/agents'  // 经纪准入审批
import voiceTokenRouter from './routes/voice-token'
import voiceToolsRouter from './routes/voice-tools'
import voiceTextRouter from './routes/voice-text'
import voiceDebugRouter from './routes/voice-debug'
import aiProjectsRouter from './routes/ai-projects'
import aiAreasRouter from './routes/ai-areas'
import aiAnalyticsRouter from './routes/ai-analytics'
import marketRouter from './routes/market'
import marketRentRouter from './routes/market-rent'  // Rent (Ejari) market layer (isolated)
import metaRouter from './routes/meta'
import lunaPublicRouter from './luna-tour/public-router'  // Luna Tour (isolated; delete line + luna-tour/ to remove)
import lunaAgentRouter from './luna-tour/agent-router'  // Luna Tour agent dashboard/analytics (isolated)
import projectInsightsRouter from './routes/project-insights'  // Detail-page investment/location intelligence (isolated)
import eventsRouter from './routes/events'  // Behaviour analytics ingest (isolated; see docs/analytics-dashboard-spec.md)
import leadsRouter from './routes/leads'  // Lead capture + intent scoring (isolated)
import favoritesRouter from './routes/favorites'  // Server-side favorites persistence + login merge (isolated)
import adminAnalyticsRouter from './routes/admin-analytics'  // Owner-only dashboard queries (isolated)
import billingRouter, { billingWebhookHandler } from './routes/billing'  // Stripe 订阅计费 (isolated; docs/stripe-billing-spec.md)
import profileRouter from './routes/profile'  // 用户角色 buyer/agent(登录后一次性选择)
import pool from './db/pool'
import { taskManager } from './services/task-manager'
import { perfMetrics } from './middleware/perfMetrics'  // per-request latency/status sampler
import { attachContext } from './middleware/context'  // network-free identity (visitor + local-verified user)
import { attribution } from './middleware/attribution'  // sampled who-called-what → api_calls
import { apiRateLimiter } from './middleware/rateLimit'  // abuse/DoS backstop (generous per-IP cap)
import { mapMeter, mapHeartbeat } from './middleware/mapMeter'  // 匿名地图每日限时(服务端强制)
import { startPerfFlusher, stopPerfFlusher } from './services/perfMonitor'  // 60s rollups + threshold alerts

const app: Application = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(helmet())

// CORS configuration - whitelisted origins
const allowedOrigins = [
  'https://pinzos.com',
  'https://www.pinzos.com',
  'https://upload-api.pinzos.com',  // Direct upload endpoint (bypasses Cloudflare)
  'http://localhost:5173',  // For local development
  'http://localhost:5174',  // Alternative local port
]

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true)
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))
app.use(morgan('dev'))

// Identity context — one network-free pass resolving visitor_id + (locally
// verified) user, so guards/handlers read req.ctx instead of each round-tripping
// to Supabase. Must run before any auth guard. See middleware/context.ts.
app.use(attachContext)

// Per-request performance sampling (latency/status/concurrency → in-memory sink).
// Mounted before routes; never touches the response. See services/perfMonitor.ts.
app.use(perfMetrics)

// Attribution — sampled who-called-what, written fire-and-forget on res.finish
// (zero latency in the request path). See middleware/attribution.ts.
app.use(attribution)

// ⚠️ Stripe webhook MUST receive the raw body for signature verification, so it is
// mounted BEFORE express.json (which would otherwise consume/parse the body).
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhookHandler)

// Increase body size limit for large PDF uploads (up to 500MB)
// Note: If using Cloudflare proxy, Free plan limits to 100MB
app.use(express.json({ limit: '500mb' }))
app.use(express.urlencoded({ extended: true, limit: '500mb' }))

// Abuse/DoS backstop — generous per-IP cap, skips realtime/webhook paths.
// Tune down later with the per-endpoint dashboard data. See middleware/rateLimit.ts.
app.use(apiRateLimiter)
console.log('🛡️  API rate limiter active (backstop; tune via RATE_LIMIT_MAX)')

// Health check
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1')
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected'
    })
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected'
    })
  }
})

// 匿名地图限时:心跳(前端可见时 30s 一次,返回剩余分钟)+ 核心地图数据面的
// 服务端强制(额度尽 → 429 map_quota_exhausted)。登录/内部号/有效分享码豁免。
app.post('/api/usage/map-heartbeat', mapHeartbeat)
app.use(
  ['/api/dubai', '/api/dubai-pois', '/api/residential-projects', '/api/transport', '/api/custom-routes', '/api/market'],
  mapMeter
)

// Routes
app.use('/api/residential-projects', projectInsightsRouter)  // Detail-page insights (/:id/insights) — before main router
app.use('/api/residential-projects', createResidentialProjectsRouter(pool))  // Residential projects API
app.use('/api/langgraph', langgraphRouter)  // LangGraph multi-agent PDF processor
app.use('/api/langgraph-progress', langgraphProgressRouter)  // LangGraph with real-time progress
app.use('/api/langgraph', langgraphValidateRouter)  // Result validation
app.use('/api/dubai', dubaiAreasLandmarksRouter)  // Dubai areas and landmarks overlay
app.use('/api/dubai-pois', dubaiPoisRouter)  // Dubai POIs (hospitals, schools, etc.)
app.use('/api/upload', uploadRouter)  // File upload to R2
app.use('/api/r2-upload', r2UploadRouter)  // Browser direct-to-R2 multipart upload (fixes Dubai large-file drops)
app.use('/api/compare', createCompareRouter(pool))  // AI property comparison
app.use('/api/tasks', tasksRouter)  // PDF processing task management
app.use('/api/admin/tasks', adminTasksRouter)  // Admin task management
app.use('/api/transport', dubaiTransportRouter)  // Dubai transport (Metro, Tram, future lines)
app.use('/api/custom-routes', customRoutesRouter)  // Custom routes and stops (replaces transport)
app.use('/api/geocode', geocodeRouter)  // Google Maps geocoding API proxy
app.use('/api/voice-chat', voiceChatRouter)  // Voice chat health check (legacy)
app.use('/api/voice', voiceTokenRouter)  // Ephemeral token generation
app.use('/api/voice', voiceTextRouter)  // Text-mode agent (typed Luna, audio-free)
app.use('/api/voice/tools', voiceToolsRouter)  // Tool execution
app.use('/api/voice/debug', voiceDebugRouter)  // Debug logs (dev only)
app.use('/api/collab', collabRouter)  // 实时协作带看 REST (建房/校验); WS 在 /api/collab
app.use('/api/voice-rtc', voiceRtcRouter)  // Agora 应用内语音 token + 用量额度
app.use('/api/agents', agentsRouter)  // 经纪准入审批(/me + owner 批准)
app.use('/api/ai/projects', aiProjectsRouter)  // AI project search & detail
app.use('/api/ai/areas', aiAreasRouter)  // AI area match, info & compare
app.use('/api/ai/analytics', aiAnalyticsRouter)  // AI investment/ROI/budget analysis (DLD data)
app.use('/api/market', marketRouter)  // 成交真相层：价格体检等
app.use('/api/market/rent', marketRentRouter)  // 租金市场层 (Ejari)
app.use('/api/meta', metaRouter)  // 数据版本指纹（客户端缓存自动失效）
app.use('/api/luna', lunaPublicRouter)  // Luna Tour public watch (isolated)
app.use('/api/luna/agent', lunaAgentRouter)  // Luna Tour agent dashboard/analytics (isolated)
app.use('/api/events', eventsRouter)  // Behaviour analytics ingest (public, batched)
app.use('/api/sync', eventsRouter)    // ⭐ ad-blocker-resistant alias of /api/events — clients post here now.
                                      //   "events" is on ad-block keyword lists; "sync" isn't, so real users'
                                      //   telemetry stops getting silently eaten. Old path kept for cached bundles.
app.use('/api/leads', leadsRouter)  // Lead capture + intent scoring
app.use('/api/favorites', favoritesRouter)  // Server-side favorites persistence + login merge
app.use('/api/admin/analytics', adminAnalyticsRouter)  // Owner-only dashboard queries (legacy path; ad-blockers eat "analytics")
app.use('/api/admin/insights', adminAnalyticsRouter)   // ⭐ ad-blocker-resistant alias — the dashboard reads here now
app.use('/api/billing', billingRouter)  // Stripe 订阅计费(webhook 已在 json parser 之前单独挂)
app.use('/api/me', profileRouter)  // 用户角色 buyer/agent

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  })
})

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err)
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  })
})

// Start server with extended timeouts for large file uploads
const server = app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`🌐 CORS enabled for: ${allowedOrigins.join(', ')}`)

  // Initialize WebSocket server for voice chat
  initVoiceChatWebSocket(server)

  // Initialize WebSocket server for collab tour (co-presence) — same http server, path /api/collab
  initCollabWebSocket(server)

  // Recover any tasks that were interrupted by server restart
  await taskManager.recoverInterruptedTasks()

  // Start perf monitor (60s rollups into perf_minute + threshold alerting).
  // 只在生产容器跑(compose 里 NODE_ENV=production):本地 dev 连的是同一个生产库,
  // 第二个 flusher 的空 sink 会每分钟把线上刚开的报警 resolve 掉(2026-07-07 实锤
  // 的「报警开了就被关」churn)。PERF_FLUSHER_DISABLED=1 是生产上的手动逃生阀。
  if (process.env.NODE_ENV === 'production' && process.env.PERF_FLUSHER_DISABLED !== '1') {
    startPerfFlusher()
  }
})

// Extend timeouts for large file uploads (10 minutes)
server.keepAliveTimeout = 600000 // 10 minutes
server.headersTimeout = 610000   // Slightly longer than keepAliveTimeout
server.timeout = 600000          // 10 minutes for request timeout

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server')
  stopPerfFlusher() // 部署替换窗口里旧实例不许再动报警/perf_minute
  await pool.end()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server')
  await pool.end()
  process.exit(0)
})

export default app
