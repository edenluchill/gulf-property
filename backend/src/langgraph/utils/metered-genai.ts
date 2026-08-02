/**
 * PDF 管线的 AI **计量外壳**。
 *
 * WHY:楼书管线的 9 个 agent 走的是**旧 SDK**(`@google/generative-ai`),没经过
 * `services/ai/gemini.ts` 那层 wrapper → 有次数、有耗时、有失败率,
 * **唯独没有 token 和钱**。一份 50 页的楼书要跑几十次多模态调用(每页一张图),
 * 这很可能是全站最大的一笔 AI 支出,而它在成本看板上是**一片空白**。
 *
 * 为什么不直接把 9 个 agent 迁到新 SDK:那是 9 个文件的行为改动(每个都有自己的
 * timeout/race/retry/JSON 修复逻辑),而 PDF 管线是收钱的核心链路,改坏了客户的
 * 楼书就缺数据。**这一层只做一件事:把 usageMetadata 读出来上报**,
 * 调用逻辑一行不动 —— 每个 agent 只需把 `new GoogleGenerativeAI(key)` 换成
 * `meteredGenAI('pricing-extractor')`。
 *
 * 埋点口径和 callGemini **完全一致**(ai.tokens / ai.cost.usd_micro),
 * task 统一加 `pdf.` 前缀 → Admin 的成本看板里 PDF 管线和其它功能能直接横向比。
 */
import { GoogleGenerativeAI } from '@google/generative-ai'
import { counter } from '../../telemetry'
import { costUsd } from '../../services/ai/pricing'

let raw: GoogleGenerativeAI | null = null
function client(): GoogleGenerativeAI {
  if (!raw) raw = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
  return raw
}

interface RawUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
}

/** 把一次调用的用量记进通用遥测。失败绝不允许影响抽取本身。 */
function record(task: string, model: string, u: RawUsage | undefined): void {
  try {
    const inTokens = u?.promptTokenCount ?? 0
    // thinking 也按 output 价计费 —— 不算它,账面成本会偏低
    const thinking = u?.thoughtsTokenCount ?? 0
    const outTokens = u?.candidatesTokenCount ?? 0
    if (!inTokens && !outTokens && !thinking) return   // 没拿到 usage,不要记 0 污染均值
    const usd = costUsd(model, { inTokens, outTokens, thinkingTokens: thinking })
    counter('ai.tokens', { task, dir: 'in' }).inc(inTokens)
    counter('ai.tokens', { task, dir: 'out' }).inc(outTokens + thinking)
    if (thinking > 0) counter('ai.tokens', { task, dir: 'thinking' }).inc(thinking)
    counter('ai.cost.usd_micro', { task, model }).inc(Math.round(usd * 1e6))
  } catch {
    /* 计量永远不许把楼书解析搞崩 */
  }
}

/**
 * 用法(每个 agent 改一行):
 *
 *   const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')   // 旧
 *   const genAI = meteredGenAI('pricing-extractor')                          // 新
 *
 * 返回的对象只暴露 `getGenerativeModel`,签名与旧 SDK 一致 —— 调用方感知不到差别。
 *
 * @param agent 低基数的 agent 名(**绝不能放页码/jobId**,label 基数会炸)
 */
export function meteredGenAI(agent: string) {
  const task = `pdf.${agent}`
  return {
    getGenerativeModel(params: Parameters<GoogleGenerativeAI['getGenerativeModel']>[0]) {
      const model = client().getGenerativeModel(params)
      const modelId = params.model
      const orig = model.generateContent.bind(model)
      // 只包 generateContent —— 管线里所有 AI 调用都从它过。
      model.generateContent = (async (...args: Parameters<typeof orig>) => {
        const result = await orig(...args)
        record(task, modelId, (result as { response?: { usageMetadata?: RawUsage } })?.response?.usageMetadata)
        return result
      }) as typeof orig
      return model
    },
  }
}
