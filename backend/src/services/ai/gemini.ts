/**
 * Gemini 调用的**唯一入口**。所有 AI 调用都从这里走。
 *
 * WHY(2026-07-13 盘点出来的现状):
 *   - **没有任何统一 wrapper** —— 20+ 个文件各自 `new GoogleGenAI(...)`,各自写模型名,
 *     各自 for-try-catch 做 fallback。同一行 MODELS 常量注释被复制了 6 遍。
 *   - **两套 SDK 并存**(新 @google/genai + 旧 @google/generative-ai)。
 *   - **零成本统计** —— 全 backend 搜不到一处 usageMetadata。花了多少钱、
 *     哪个功能在烧,完全不知道。
 *   - **失败静默** —— 典型写法是 `catch { /* try next model *\/ }`,全挂了就返回
 *     null。**AI 挂了没有任何人会知道**。
 *
 * 代价是实打实的:PDF 楼书管线的 project-description-generator 用着一个**已经 404**
 * 的模型(gemini-3-pro-preview),每传一份楼书那步都在失败 —— 靠一行 console.warn,
 * 一直没人发现。有这一层 + 埋点,这种事**当天就会报出来**。
 *
 * 这一层负责:单例 client · 模型 fallback · 计时 · 错误分类 · **token → 美元** · 埋点。
 * 调用方只写 task 名和 prompt。
 */
import { GoogleGenAI } from '@google/genai'
import { counter, histogram } from '../../telemetry'
import { DEFAULT_CHAIN, costUsd } from './models'

// 单例 —— 原来每个文件一个 client。
let client: GoogleGenAI | null = null
function ai(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  return client
}

export interface GeminiCall {
  /** 埋点用的**低基数**任务名,如 'tour-generator' / 'pdf.pricing-extractor'。
   *  绝不能放 jobId/userId(会炸 label 基数)。 */
  task: string
  /** 模型链:依次尝试,直到成功。默认 [FLASH, FLASH_LITE]。 */
  models?: readonly string[]
  contents: unknown
  config?: Record<string, unknown>
}

export interface GeminiResult<T = unknown> {
  text: string
  /** 原始响应 —— tts 之类要拿 inlineData 的调用方需要它。 */
  resp: T
  model: string          // 真正成功的那个模型
  ms: number
  inTokens: number
  outTokens: number
  usd: number
}

/**
 * 错误分类 —— 低基数,能进 label。分不清具体原因时不要瞎编,归 'other'。
 * 导出给旧 SDK 那条线(langgraph/utils/ai-retry.ts)复用 —— 两套 SDK 的失败原因
 * 必须用**同一套口径**,否则告警和看板对不上。
 */
export function classifyAiError(e: unknown): string {
  const m = String((e as Error)?.message || e).toLowerCase()
  if (m.includes('404') || m.includes('no longer supported') || m.includes('not found')) return 'model_gone'
  if (m.includes('429') || m.includes('quota') || m.includes('rate')) return 'rate_limited'
  if (m.includes('timeout') || m.includes('deadline')) return 'timeout'
  if (m.includes('safety') || m.includes('blocked')) return 'safety_blocked'
  if (m.includes('500') || m.includes('503') || m.includes('unavailable')) return 'upstream_5xx'
  return 'other'
}

/**
 * 调 Gemini。按 models 顺序 fallback,全挂才抛。
 *
 * 埋点(全站 AI 一处覆盖):
 *   ai.call{task,model}        次数
 *   ai.call.ms{task}           耗时分布
 *   ai.call.failed{task,reason}失败(reason=model_gone/rate_limited/timeout/…)
 *   ai.call.fallback{task}     主模型挂了、退到备用(**说明主模型有问题,值得单独看**)
 *   ai.tokens{task,dir}        token 用量
 *   ai.cost.usd_micro{task}    成本(微美元;counter 只能整数 → ×1e6 存)
 */
export async function callGemini<T = unknown>(opts: GeminiCall): Promise<GeminiResult<T>> {
  const models = opts.models?.length ? opts.models : DEFAULT_CHAIN
  const t0 = Date.now()
  let lastErr: unknown = null

  for (let i = 0; i < models.length; i++) {
    const model = models[i]
    try {
      const resp = await ai().models.generateContent({
        model,
        contents: opts.contents as never,
        ...(opts.config ? { config: opts.config as never } : {}),
      })

      const ms = Date.now() - t0
      const u = (resp as unknown as {
        usageMetadata?: {
          promptTokenCount?: number
          candidatesTokenCount?: number
          thoughtsTokenCount?: number
        }
      }).usageMetadata
      const inTokens = u?.promptTokenCount ?? 0
      /**
       * 🔴 **thinking token 是按 output 价计费的**,而我们之前**根本没在算它**。
       *
       * 于是成本看板上的数字是**偏低的** —— 一个默认开着 thinking 的任务,
       * 真实花费可能是账面的两倍。不设 thinkingLevel 就是默认全开。
       * (Gemini 3.x 用 `thinkingLevel`,不是 2.5 的 `thinkingBudget` —— 写错会被静默忽略。)
       */
      const thinkTokens = u?.thoughtsTokenCount ?? 0
      const outTokens = (u?.candidatesTokenCount ?? 0) + thinkTokens
      const usd = costUsd(model, inTokens, outTokens)

      counter('ai.call', { task: opts.task, model }).inc()
      histogram('ai.call.ms', { task: opts.task }).observe(ms)
      counter('ai.tokens', { task: opts.task, dir: 'in' }).inc(inTokens)
      counter('ai.tokens', { task: opts.task, dir: 'out' }).inc(outTokens)
      if (thinkTokens > 0) counter('ai.tokens', { task: opts.task, dir: 'thinking' }).inc(thinkTokens)
      // counter 只累加整数 → 存微美元(1 USD = 1e6)。读的时候再除回去。
      counter('ai.cost.usd_micro', { task: opts.task }).inc(Math.round(usd * 1e6))
      // 退到备用模型 = 主模型有问题(废弃/限流/挂了)。这个指标就是模型漂移的哨兵。
      if (i > 0) counter('ai.call.fallback', { task: opts.task }).inc()

      return {
        text: (resp as unknown as { text?: string }).text ?? '',
        resp: resp as T,
        model, ms, inTokens, outTokens, usd,
      }
    } catch (e) {
      lastErr = e
      counter('ai.call.failed', { task: opts.task, reason: classifyAiError(e) }).inc()
      // 继续退到下一个模型
    }
  }

  histogram('ai.call.ms', { task: opts.task }).observe(Date.now() - t0)
  counter('ai.call.exhausted', { task: opts.task }).inc()   // 全链路都挂了 = 这个功能此刻是坏的
  throw lastErr
}
