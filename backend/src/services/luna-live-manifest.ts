/**
 * Luna **Live 层工具清单** —— 工具声明的唯一真相源。
 *
 * ## 🔴 为什么必须让 Live 看到完整的 23 个工具
 *
 * 2026-08-10 拆两层时我把 17 个具体工具砍成 1 个抽象入口 `ask_luna`。
 * **那是这次事故的根因**，不是「2.5 模型不可靠」：
 *
 *   拆层前 Live 看到 → `get_investment_breakdown: "Investment breakdown for…"`
 *                      `rent_vs_buy: "Indicative rent-vs-buy comparison…"`
 *           它要做的 → **语义匹配**:客户问回报率 → 对上了 → 调。最简单的判断。
 *
 *   拆层后 Live 看到 → `ask_luna: "你什么都不知道,任何真实问题都问这个"`
 *           它要做的 → **元判断**:「这算不算真实问题?我该不该承认自己不知道?」
 *
 * **工具的 description 本身就是模型的能力清单。** 砍掉具体工具 = 把线索删了,
 * 让它去做小模型最不擅长的元判断。于是它有时候就自己答了 ——
 * owner 看到的「AI 说自己能卖二手房」就是这么冒出来的
 * (同样的问题直接问 Brain,三种问法答案全对)。
 *
 * ## 但执行仍然全部走 Brain
 *
 * Live **声明**这些工具只是为了「知道自己能干什么」。它调用时前端统一拦截,
 * 把 `intendedTool` 当**意图信号**转给 Brain —— Brain 自己决定真正调什么。
 * 见 `docs/luna-tool-routing-spec.md`。
 *
 * ## 单一真相源
 *
 * 声明从 `voiceAssistantTools`(执行器那份)派生,随 `/api/voice/token` 下发。
 * **前端不再硬编码,跑分脚本不再内联第二份** —— 三处漂移的老毛病
 * (memory `voice-tool-declaration-drift`)到此为止。
 */
import { voiceAssistantTools } from './voice-assistant-tools'

export interface LiveToolDecl {
  name: string
  description: string
  parameters?: unknown
}

/**
 * 纯 UI 动作 —— 只动地图、不产生任何事实陈述。
 *
 * Brain 对这些走**单轮快路径**(执行 + 一次成稿 ≈1.5s),不走两轮。
 * 「带我去 Marina」等 4 秒是不可接受的,而这类调用也没有幻觉风险。
 */
export const UI_ACTION_TOOLS = new Set([
  'fly_to_area',
  'reset_map',
  'open_project_detail',
  'navigate_to_project',
  'add_to_favorites',
  'highlight_projects',
])

/** 前端自己处理、不进 Brain 的工具（写库，不查数据）。 */
export const FRONTEND_ONLY_TOOLS: LiveToolDecl[] = [
  {
    name: 'capture_contact',
    description:
      "Save the customer's contact details so the agent can follow up with full property info. " +
      'Call this ONLY after the customer has shown clear interest and agreed to share contact ' +
      '(e.g. they said yes to receiving details on WhatsApp). Ask naturally; never pressure.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: "Customer's name if given" },
        whatsapp: { type: 'STRING', description: 'WhatsApp number with country code, e.g. +971501234567' },
        phone: { type: 'STRING', description: 'Phone number if different from WhatsApp' },
        email: { type: 'STRING', description: 'Email address if given' },
      },
    },
  },
]

/**
 * JSON Schema 的 `type` 在执行器那份里是小写（'object'/'string'），
 * Gemini Live 的 SDK 期望大写枚举。**统一在这里转**，别让调用方各转各的
 * —— 那正是三处漂移的起点。
 */
function upperTypes(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(upperTypes)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : upperTypes(v)
    }
    return out
  }
  return node
}

/** 下发给 Live 的完整清单：23 个执行器 + 前端直连的那些。 */
export function liveToolManifest(): LiveToolDecl[] {
  const declared = (voiceAssistantTools[0]?.functionDeclarations || []) as LiveToolDecl[]
  const fromExecutors = declared.map(d => ({
    name: d.name,
    description: d.description,
    ...(d.parameters ? { parameters: upperTypes(d.parameters) } : {}),
  }))
  return [...fromExecutors, ...FRONTEND_ONLY_TOOLS]
}

/** 这个工具名是不是真实存在的（漂移守卫用）。 */
export function isKnownTool(name: string): boolean {
  return liveToolManifest().some(t => t.name === name)
}
