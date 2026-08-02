/**
 * /api/telemetry — 客户端真实体验(RUM)上报入口。
 *
 * WHY:2026-07-13「实时带看半分钟延迟」的**真凶在客户端**(首屏 + 4.8MB 卫星瓦片,
 * 弱网 16–20s),而服务端链路完全健康(端到端 161ms)。我们当时对客户端一无所知,
 * 只能临时写 playwright 探针去模拟。这个端点让真实客户的设备把数字直接告诉我们。
 *
 * 匿名可用(客户看带看不需要登录)。因此必须防灌垃圾:
 *   1. **指标名白名单** —— 只接受下面登记过的,其它一律丢。否则任何人都能往我们
 *      库里灌任意 series,把基数护栏顶爆。
 *   2. **数值范围钳制** —— 负数/NaN/离谱大值直接丢(不然一条 1e9 会毁掉整个 p95)。
 *   3. 单请求条数上限 + 全局 rate limit(index.ts 的 apiRateLimiter 已覆盖)。
 */
import { Router, Request, Response } from 'express'
import { counter, histogram, collabJoin, COLLAB_JOIN_STEPS } from '../telemetry'
import { LIVE_AUDIO } from '../services/ai/models'
import { costUsd, type Usage } from '../services/ai/pricing'

const router = Router()

/**
 * 把客户端报上来的 Live token 折算成钱,记进和其它 AI 功能**同一套**指标
 * (task='luna-live')→ 成本看板上 Luna 语音能和 tour 生成、楼书解析并排比较。
 *
 * 模态很重要:native audio 的**音频输出单价是文本输出的 6 倍**,
 * 全按文本算会把一通电话的成本低估到零头。
 */
function meterLiveVoice(labels: Record<string, string>, tokens: number): void {
  try {
    const dir = labels.dir === 'in' ? 'in' : 'out'
    const isAudio = (labels.modality || '').toLowerCase() === 'audio'
    const u: Usage =
      dir === 'in'
        ? isAudio ? { audioInTokens: tokens } : { inTokens: tokens }
        : isAudio ? { audioOutTokens: tokens } : { outTokens: tokens }
    const task = 'luna-live'
    counter('ai.tokens', { task, dir: isAudio ? `audio_${dir}` : dir }).inc(tokens)
    counter('ai.cost.usd_micro', { task, model: LIVE_AUDIO }).inc(
      Math.round(costUsd(LIVE_AUDIO, u) * 1e6)
    )
  } catch {
    /* 静默 —— 上报永远不许把请求搞崩 */
  }
}

/**
 * 允许上报的指标 —— 白名单即契约。加新指标要同时改这里和前端。
 * value 的合理上限(ms / bytes):超了当脏数据丢。
 */
const ALLOWED: Record<string, { kind: 'histogram' | 'counter'; max: number }> = {
  // 实时带看:客户点「进入带看」之后的真实体感
  'rum.collab.ttfc.ms':     { kind: 'histogram', max: 120_000 },  // → 收到第一帧相机(4G 实测 1.2s)
  'rum.collab.tiles.ms':    { kind: 'histogram', max: 300_000 },  // → 瓦片追完、画面可看(4G 2.5s / 弱网 8.6s)
  'rum.collab.tiles.bytes': { kind: 'histogram', max: 200_000_000 }, // 首屏瓦片字节(实测 4.8MB ← 真凶)
  'rum.collab.ws_open.ms':  { kind: 'histogram', max: 120_000 },
  // 通用页面性能(任何页面都能用)
  'rum.page.dcl.ms':        { kind: 'histogram', max: 300_000 },  // DOMContentLoaded(弱网实测 7.8s)
  'rum.page.error':         { kind: 'counter',   max: 100 },
  /**
   * Luna 实时语音的 token 用量。**只能从客户端来** —— 前端直连 Gemini Live,
   * 后端不在链路里,服务端拿不到 usageMetadata。不收这条,Live 的成本
   * (而且是全站单价最贵的音频输出)在账上就是**零**。
   * 单条上限按「一场 30 分钟通话的量级」定,超了当脏数据丢。
   */
  'rum.luna_live.tokens':   { kind: 'counter',   max: 5_000_000 },
}

/**
 * 低基数 label 白名单 —— 绝不接受客户端传任意 key(会炸基数)。
 * modality: text/audio —— Live 的音频输出单价是文本的 6 倍,不分模态就算不出钱。
 */
const ALLOWED_LABEL_KEYS = new Set(['page', 'net', 'device', 'modality', 'dir'])
const MAX_LABEL_LEN = 24

function cleanLabels(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_LABEL_KEYS.has(k)) continue
    const s = String(v).slice(0, MAX_LABEL_LEN)
    if (s) out[k] = s
  }
  return out
}

const MAX_ITEMS = 20

/**
 * POST /api/telemetry/rum
 * body: { metrics: [{ name, value, labels? }], funnel?: { name, step } }
 *
 * 永远返回 204 —— 上报失败不该让客户端重试/报错,更不该暴露白名单内容。
 */
router.post('/rum', (req: Request, res: Response) => {
  try {
    const items = Array.isArray(req.body?.metrics) ? req.body.metrics.slice(0, MAX_ITEMS) : []
    for (const it of items) {
      const name = String(it?.name || '')
      const spec = ALLOWED[name]
      if (!spec) continue                                   // 白名单外:丢
      const v = Number(it?.value)
      if (!Number.isFinite(v) || v < 0 || v > spec.max) continue  // 脏数据:丢
      const labels = cleanLabels(it?.labels)
      if (spec.kind === 'histogram') histogram(name, labels).observe(v)
      else counter(name, labels).inc(Math.min(v, spec.max))
      // Live 语音:客户端只报 token 数,**钱一律在服务端按单价算**
      // (成本绝不能让客户端传 —— 那是可以随便编的数字)。
      if (name === 'rum.luna_live.tokens') meterLiveVoice(labels, Math.min(v, spec.max))
    }

    // 进房漏斗的前两步只有前端知道(点开链接 / 提交称呼)
    const step = String(req.body?.funnel?.step || '')
    if (req.body?.funnel?.name === 'collab.join' && (COLLAB_JOIN_STEPS as readonly string[]).includes(step)) {
      collabJoin.step(step)
    }
  } catch {
    /* 上报永远不许把请求搞崩 */
  }
  res.status(204).end()
})

export default router
