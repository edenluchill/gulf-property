/**
 * Voice Text-Mode Agent API
 *
 * Text path for Luna (方案 B): typed input, NO audio. Separate from the Gemini Live
 * voice pipeline — the key stays server-side. Reuses the same executor (executeTool,
 * which returns { result, summary, mapAction }) so typing "does" everything voice
 * does (fly map, open project, cards, investment chart).
 *
 * WHY NOT native function-calling: gemini function-calling is ERRATIC from this
 * production server's region (same key/model/prompt/SDK acts 12/12 locally but
 * greets / picks wrong tools on the server). Plain TEXT generation, however, is
 * reliable there (its greetings are fluent). So we use a 2-step approach:
 *   1) CLASSIFY  — ask the model for plain JSON { tool, args, say } (text output).
 *   2) EXECUTE   — WE call executeTool(tool, args) ourselves (no model tool-pick).
 *   3) PHRASE    — ask the model to summarize the tool result in one short reply.
 * This sidesteps the flaky function-calling entirely.
 *
 * best-effort: any failure returns a friendly message, never a 500.
 */

import { Router } from 'express'
import { FLASH } from '../services/ai/models'
import { callGemini } from '../services/ai/gemini'
import { executeTool } from '../services/voice-assistant-tools'
import { convertToolsForSDK } from '../services/voice-assistant'

const router = Router()

// Valid tool names (for validating the classifier's choice).
const TOOL_NAMES = new Set(convertToolsForSDK().map((d: any) => d.name))

interface IncomingMessage { role?: string; text?: string }

const GLOSSARY =
  '伊曼/艾玛→Emaar、达马克/迪马克→DAMAC、纳克希尔→Nakheel、索巴→Sobha、迈拉斯→Meraas、宾加提→Binghatti；' +
  '马瑞纳/码头→Dubai Marina、市中心→Downtown Dubai、朱美拉村/JVC→JVC、商业湾→Business Bay、迪拜山庄→Dubai Hills Estate、' +
  '棕榈岛→Palm Jumeirah、达马克山→DAMAC Hills、阿拉伯牧场→Arabian Ranches、富尔詹→Al Furjan、金融中心→DIFC、美丹→Meydan、国际城→International City'

/** Step 1 prompt: classify the user's message into a single tool + args, as JSON. */
function classifyPrompt(language: string): string {
  const common = `
可用工具与参数(选最合适的一个):
- search_projects{area?, min_price?, max_price?, bedrooms?, developer?} —— 找房源/某区有什么房/某开发商项目/N居/预算内房源
- fly_to_area{area_name} —— 带我去某区/看看某区/某区在哪
- area_investment_report{area, property_type?, bedrooms?} —— 某区投资回报/值不值/ROI/收益/帮我分析这个区
- analyze_area_amenities{area_name} —— 某区生活方便吗/周边配套/离医院学校地铁多远
- recommend_by_budget{budget, property_type?, bedrooms?} —— X万预算能买哪/推荐区域
- compare_areas{area1, area2} —— 对比两个区
- get_area_info{area_name} —— 某区基本信息/房价
- navigate_to_project{project_name} —— 明确点名某个具体项目
- measure_distance{from?, to?, places?} —— A到B多远
- check_affordability{income, cash} —— 我收入X能买多少
- reset_map{} —— 清空地图/重置

区域/开发商模糊音映射(把口音写法映射成真实英文名,填进 args): ${GLOSSARY}。

只输出一个 JSON 对象,不要 markdown、不要解释:
{"tool": "<上面某个工具名,或 null>", "args": { ... }, "say": "<仅当 tool 为 null 时,用${language === 'zh' ? '中文' : 'English'}直接回答用户;否则空字符串>"}

规则:
- 用户在找房/问区域/问投资/预算相关 → 必须选对应工具,别选 null。
- 只有纯闲聊/问候/与迪拜房产无关 → tool=null,用 say 简短回应。
- args 里区域名用英文(按映射表);预算 budget 用数字(200万=2000000)。`

  const examples = `
示例:
用户: 带我去棕榈岛 → {"tool":"fly_to_area","args":{"area_name":"Palm Jumeirah"},"say":""}
用户: 商业湾投资回报怎么样 → {"tool":"area_investment_report","args":{"area":"Business Bay"},"say":""}
用户: 迪拜山庄生活方便吗 → {"tool":"analyze_area_amenities","args":{"area_name":"Dubai Hills Estate"},"say":""}
用户: 朱美拉村有什么房 → {"tool":"search_projects","args":{"area":"JVC"},"say":""}
用户: 200万预算能买哪 → {"tool":"recommend_by_budget","args":{"budget":2000000},"say":""}
用户: 对比JVC和商业湾 → {"tool":"compare_areas","args":{"area1":"JVC","area2":"Business Bay"},"say":""}
用户: 谢谢 → {"tool":null,"args":{},"say":"不客气！还想看哪个区或项目?"}`

  return `你是 Luna,迪拜期房 App 的意图分类器。把用户这句话映射到一个工具调用。${common}${examples}`
}

/** Step 3 prompt: turn the tool result into one short, buyer-facing reply. */
function phrasePrompt(language: string): string {
  return language === 'zh'
    ? '你是 Luna,迪拜房产助手。根据"工具结果"用简洁中文回答用户(2-4 句),只讲买家关心的:户型/面积/价格/回报。若结果为 0 条,别冷场,建议看邻近区域。不要寒暄、不要自我介绍、不要重复工具名。'
    : 'You are Luna, a Dubai property assistant. Using the TOOL RESULT, answer the user concisely in English (2-4 sentences): bedrooms/size/price/yield. If 0 results, suggest nearby areas. No greeting, no self-intro.'
}

async function genText(contents: any, extra: any = {}): Promise<string> {
  // NOTE: no thinkingBudget:0 here. These are plain text steps (no tools), and
  // thinking-OFF measurably degrades the server model's instruction-following /
  // classification. Let it think.
  const { text } = await callGemini({
    task: 'voice-text',
    models: [FLASH],   // 这里从来只用旗舰,不退到 lite —— 分类质量比省钱重要
    contents,
    config: { ...extra },
  })
  return text.trim()
}

/** Parse the classifier's JSON defensively (strip code fences / stray text). */
function parsePlan(raw: string): { tool: string | null; args: any; say: string } {
  const fallback = { tool: null, args: {}, say: '' }
  if (!raw) return fallback
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const a = s.indexOf('{'); const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  try {
    const p = JSON.parse(s)
    return { tool: typeof p.tool === 'string' ? p.tool : null, args: p.args && typeof p.args === 'object' ? p.args : {}, say: typeof p.say === 'string' ? p.say : '' }
  } catch { return fallback }
}

/**
 * POST /api/voice/text
 * Body: { messages: [{role:'user'|'model', text}], text, language }
 * Returns: { reply: string, steps: [{ name, result, mapAction }] }
 */
router.post('/text', async (req, res) => {
  const language = req.body?.language === 'zh' ? 'zh' : (req.body?.language || 'en')
  const failReply = language === 'zh' ? '刚刚有点忙不过来，麻烦再说一次？' : 'Something went wrong on my side — please try again.'

  try {
    if (!process.env.GEMINI_API_KEY) return res.json({ reply: failReply, steps: [] })

    const text: string = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    const history: IncomingMessage[] = Array.isArray(req.body?.messages) ? req.body.messages : []
    if (!text) return res.json({ reply: language === 'zh' ? '想了解点什么？' : 'What can I help you with?', steps: [] })

    // Conversation context (prior turns + new message) — used by both steps so
    // follow-ups like "那第二个多少钱" resolve against what was just discussed.
    const contents: any[] = []
    for (const m of history) {
      if (!m || typeof m.text !== 'string' || !m.text.trim()) continue
      contents.push({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] })
    }
    contents.push({ role: 'user', parts: [{ text }] })

    // ── Step 1: classify → { tool, args, say } (plain JSON text; reliable) ──
    const planRaw = await genText(contents, {
      systemInstruction: classifyPrompt(language),
      responseMimeType: 'application/json',
    })
    const plan = parsePlan(planRaw)

    // No tool needed → just answer.
    if (!plan.tool || !TOOL_NAMES.has(plan.tool)) {
      return res.json({ reply: plan.say || (language === 'zh' ? '想看哪个区或项目?' : 'Which area or project would you like to see?'), steps: [] })
    }

    // ── Step 2: WE execute the chosen tool (no model tool-pick) ──
    let summary = ''
    const steps: Array<{ name: string; result: unknown; mapAction?: unknown }> = []
    try {
      const r = await executeTool(plan.tool, plan.args || {})
      summary = r.summary || ''
      steps.push({ name: plan.tool, result: r.result, mapAction: r.mapAction })
    } catch (toolErr) {
      console.error(`[Voice Text] tool ${plan.tool} failed:`, toolErr)
    }

    // ── Step 3: phrase a short reply from the tool result ──
    let reply = ''
    try {
      const resultText = JSON.stringify(steps[0]?.result ?? {}).slice(0, 4000)
      reply = await genText([
        { role: 'user', parts: [{ text: `用户: ${text}\n工具: ${plan.tool}\n工具结果(摘要): ${summary}\n工具结果(数据): ${resultText}` }] },
      ], { systemInstruction: phrasePrompt(language) })
    } catch { /* fall through */ }
    if (!reply) reply = summary || (language === 'zh' ? '已经帮你在地图上处理好了。' : "Done — I've updated the map.")

    res.json({ reply, steps })
  } catch (error) {
    console.error('[Voice Text] Error:', error)
    res.json({ reply: failReply, steps: [] })
  }
})

export default router
