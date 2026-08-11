/**
 * Gemini 模型 —— **单一真相源**。全站只在这里写模型名。
 *
 * WHY:模型名原来散在 20+ 个文件里各写各的(同一行 `const MODELS = [...]` 注释被
 * 复制了 6 遍),结果就是**改一半漏一半**:
 *
 *   2026-07-13 实测:PDF 楼书管线的 9 个 agent 全部还写着 `gemini-3-flash-preview`
 *   (已废弃),其中 project-description-generator 写的 `gemini-3-pro-preview`
 *   **已经是 404**("This model is no longer supported")→ 每传一份楼书,项目描述
 *   生成必然失败,withRetry 重试 3 次后抛错,**只有一行 console.warn,没人看得见**。
 *   上一轮修模型名只修了 luna-tour 那一半,PDF 管线整条漏掉了。
 *
 * 这就是为什么模型名必须收口到一处 + 必须有埋点(见 services/ai/gemini.ts)。
 *
 * 价格来自 CLAUDE.md(2026-07-12 核对官方文档)。改模型先跑:
 *   npx ts-node -T scripts/check-gemini-models.ts   # 真调一次,看还活着没
 */

/** 默认:生成/创作/抽取。GA 旗舰 Flash(2026-05-19)。 */
export const FLASH = 'gemini-3.5-flash'
/** 极省钱的轻活 / fallback。GA。 */
export const FLASH_LITE = 'gemini-3.1-flash-lite'
/** 复杂推理。无免费额度。 */
export const PRO = 'gemini-3.1-pro-preview'
/**
 * Live API(实时语音对话)。
 *
 * 2026-08-10 从 `gemini-2.5-flash-native-audio-preview-12-2025` 升上来。
 * 音频同价($3/$12 per 1M ≈ $0.005/$0.018 每分钟),延迟 ~200ms(旧 ~300ms),
 * 噪声处理更好,**ComplexFuncBench Audio 90.8%、比上一代高约 20%** ——
 * 而工具调用正是我们的痛点。
 *
 * ⚠️ 之前有一轮 A/B 判它「更差、会编项目名」,**那个结论作废**:
 * ①「编项目名」是跑分裁判的假红灯(工具返回被截断,项目其实真实存在);
 * ② 那次测试的架构是「Live 只有一个抽象工具 ask_luna」—— 条件本身就是错的。
 * 换模型要重新 A/B:`npx ts-node -T scripts/luna-eval-live.ts --model <id>`。
 */
export const LIVE_AUDIO = 'gemini-3.1-flash-live-preview'

/**
 * TTS(把 tour 的旁白合成语音)。按顺序 fallback —— TTS 模型换代很勤,
 * 留一条链比钉死一个稳。
 */
export const TTS_CHAIN = [
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
] as const

/** 标准调用链:先旗舰,失败退到便宜的。 */
export const DEFAULT_CHAIN = [FLASH, FLASH_LITE] as const

/**
 * 单价**不在这里** —— 见 `services/ai/pricing.ts`。
 *
 * 分开的理由:这张表只管「叫什么名字」(会因为 Google 关停模型而变),
 * 价格表要管「多少钱」且要覆盖**别的 provider**(以后换 ChatGPT/Claude)。
 * 混在一起,换 provider 就得动模型常量。
 */
export { costUsd, priceOf, whatIfUsd, PRICES } from './pricing'

/**
 * ❌ 别再写这些(全是死的或将死的):
 *   gemini-3-flash / gemini-3.1-flash / gemini-3.1-pro  —— 404,不存在
 *   gemini-3-flash-preview                              —— 已废弃(替代品 = FLASH)
 *   gemini-3-pro-preview                                —— **已关停,调用直接 404**
 *   gemini-2.5-*(除 LIVE_AUDIO)                        —— deprecated,最早 2026-10-16 关停
 *   *-latest 别名                                       —— 会被静默热切换
 */
export const BANNED = [
  'gemini-3-flash',
  'gemini-3.1-flash',
  'gemini-3.1-pro',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
]
