/**
 * Luna 自测 runner —— **admin 里点一下就能跑，AI 走同一个接口**。
 *
 * ## 为什么要把跑分搬进服务端
 *
 * 之前三套跑分全是 CLI：只有开发者能跑、结果不落库、admin 看不到、
 * 没法做「这次 vs 上次」。owner 的要求是
 * **「完整能自己测试和看测试结果的 admin 页面」**。
 *
 * 关键设计：**人手触发和 AI 触发是同一条路径**（`POST /api/admin/luna/test`）。
 * 两条路径会长出两套结果，然后谁都不信 —— 本次重构一直在消灭这类分裂。
 * 场景定义也共享（`luna-test-scenarios.ts`），不再各写一份。
 *
 * ## 两种 kind
 *
 * - `brain`：只测大脑（不连 Live）。**秒级、几分钱、确定性高**，日常回归用这个。
 * - `live`：连真 Live 模型 + 真提示词 + 真工具清单，测**「Live 会不会调工具」**
 *   —— 那是 2026-08-10 两起事故的共同路径。慢、烧额度，改完架构才跑。
 *
 * ⚠️ 全程不抛：跑挂了写进 `luna_test_runs.error`，不是让 HTTP 500。
 */
import pool from '../db/pool'
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai'
import { FLASH, LIVE_AUDIO } from './ai/models'
import { callGemini } from './ai/gemini'
import { askLuna } from './luna-brain'
import { getSystemInstruction } from '../routes/voice-token'
import { liveToolManifest } from './luna-live-manifest'
import { SCENARIOS, type Scenario } from './luna-test-scenarios'

export function listScenarios() {
  return SCENARIOS.map(s => ({ id: s.id, tag: s.tag, turns: s.turns, why: s.why }))
}

interface CaseResult {
  scenarioId: string
  tag: string
  passed: boolean
  score: number | null
  verdict: string
  turns: Array<{ user: string; reply: string; tools: string[]; askedBrain: boolean; ms: number }>
  failures: string[]
  ms: number
}

/** 判定 —— 只放**确定性**的东西，主观的交给裁判。 */
function assertTurn(sc: Scenario, t: { user: string; reply: string; tools: string[]; askedBrain: boolean }): string[] {
  const bad: string[] = []
  // 🔴 最重要的一条：这一轮有没有查过。没查就开口 = 绕开全部护栏。
  if (!sc.noToolOk && !t.askedBrain) {
    bad.push(`没调任何工具就开口：「${(t.reply || '(沉默)').slice(0, 50)}」`)
  }
  if (!t.reply.trim()) bad.push('完全没有回复（客户听到的是静默）')
  // 语言一致性
  const hasCJK = /[一-鿿]/.test(t.reply)
  if (sc.wantLang === 'zh' && !hasCJK && t.reply.trim()) bad.push('客户说中文，Luna 回了非中文')
  if (sc.wantLang === 'en' && hasCJK) bad.push('客户说英文，Luna 蹦出中文')
  // 张冠李戴
  for (const f of sc.forbidMentions || []) {
    if (new RegExp(f, 'i').test(t.reply)) bad.push(`提到了不该提的「${f}」`)
  }
  // 产品指路答对没有
  if (sc.mustMentionAny?.length && !sc.mustMentionAny.some(m => new RegExp(m, 'i').test(t.reply))) {
    bad.push(`没提到 ${sc.mustMentionAny.join(' / ')} 中的任何一个`)
  }
  // markdown 不该出现在要念出来的话里
  if (/[*#`]|^\s*[-•]\s/m.test(t.reply)) bad.push('回复里有 markdown（这是要念出来的）')
  return bad
}

/** LLM 裁判 —— 补充信号；确定性检查说挂就是挂，不给它翻案。 */
async function judge(sc: Scenario, turns: CaseResult['turns']): Promise<{ score: number; verdict: string }> {
  const convo = turns
    .map(t => `客户: ${t.user}\n调用的工具: ${t.tools.join(', ') || '(无)'}\nLuna: ${t.reply || '(沉默)'}`)
    .join('\n---\n')
  try {
    const r = await callGemini({
      task: 'luna-self-test.judge',
      models: [FLASH],
      contents: [{
        role: 'user',
        parts: [{
          text:
            `你在评估一个迪拜房产语音顾问 Luna 的一段对话。\n\n` +
            `这条用例针对的历史问题：${sc.why}\n\n` +
            `=== 对话 ===\n${convo}\n\n` +
            `按「一个优秀的真人置业顾问」的标准打 1-5 分。关注：答得对不对题、` +
            `有没有把天聊死、语气自不自然、有没有给下一步。\n` +
            `**只根据上面看得到的内容判断，看不到的不许断言。**\n` +
            `严格输出 JSON：{"score":1-5,"verdict":"一句话理由"}`,
        }],
      }],
      config: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
    })
    const j = JSON.parse(r.text)
    return { score: Number(j.score) || 0, verdict: String(j.verdict || '') }
  } catch (e) {
    return { score: 0, verdict: `裁判失败：${(e as Error)?.message || e}` }
  }
}

/** 大脑层：直接调 askLuna，不连 Live。快、便宜、确定性高。 */
async function runBrainCase(sc: Scenario): Promise<CaseResult> {
  const t0 = Date.now()
  const turns: CaseResult['turns'] = []
  const failures: string[] = []
  const sessionId = `selftest_${sc.id}_${t0}`
  for (const user of sc.turns) {
    const s0 = Date.now()
    const a = await askLuna({ question: user, sessionId })
    const t = {
      user, reply: a.speech, tools: a.debug.toolsUsed,
      askedBrain: true,               // 大脑层按定义就是问过了
      ms: Date.now() - s0,
    }
    turns.push(t)
    failures.push(...assertTurn(sc, t).map(f => `第${turns.length}轮：${f}`))
  }
  const { score, verdict } = await judge(sc, turns)
  return { scenarioId: sc.id, tag: sc.tag, passed: failures.length === 0, score, verdict, turns, failures, ms: Date.now() - t0 }
}

/**
 * Live 层：连真模型 + 真提示词 + 真工具清单，用文字注入代替麦克风。
 *
 * ⚠️ 测不到 VAD / 打断 / 音频质量 —— 那要真机（Playwright）。
 * 但它能测到**最要命的那件事：Live 到底调不调工具**。
 */
async function runLiveCase(sc: Scenario, model: string): Promise<CaseResult> {
  const t0 = Date.now()
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
  const turns: CaseResult['turns'] = []
  const failures: string[] = []
  const sessionId = `selftest_${sc.id}_${t0}`

  let replyBuf = ''
  let toolsThisTurn: string[] = []
  let askedBrain = false
  let turnDone: (() => void) | null = null
  let currentUser = ''

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      systemInstruction: { parts: [{ text: getSystemInstruction('auto') }] },
      tools: [{ functionDeclarations: liveToolManifest() as never }],
    },
    callbacks: {
      onopen: () => {},
      onmessage: async (m: LiveServerMessage) => {
        if (m.serverContent?.outputTranscription?.text) replyBuf += m.serverContent.outputTranscription.text
        if (m.toolCall) {
          const responses: unknown[] = []
          for (const fc of m.toolCall.functionCalls || []) {
            toolsThisTurn.push(fc.name!)
            let out = 'Action completed.'
            if (fc.name === 'capture_contact') {
              out = 'Contact saved.'
            } else {
              askedBrain = true
              // 与生产完全一致：Live 选的工具降级成 intendedTool，Brain 决定真正调什么
              const a = await askLuna({
                question: currentUser,
                intendedTool: fc.name!,
                intendedParams: (fc.args as Record<string, unknown>) || {},
                sessionId,
              })
              out = a.speech
            }
            responses.push({ id: fc.id, name: fc.name, response: { output: out } })
          }
          session.sendToolResponse({ functionResponses: responses as never })
        }
        if (m.serverContent?.turnComplete) turnDone?.()
      },
      onerror: () => {},
      onclose: () => {},
    },
  })

  try {
    for (const user of sc.turns) {
      currentUser = user
      replyBuf = ''
      toolsThisTurn = []
      askedBrain = false
      const s0 = Date.now()
      const done = new Promise<void>(r => { turnDone = r })
      session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: user }] }], turnComplete: true })
      await Promise.race([done, new Promise<void>(r => setTimeout(r, 45_000))])
      const t = { user, reply: replyBuf.trim(), tools: [...toolsThisTurn], askedBrain, ms: Date.now() - s0 }
      turns.push(t)
      failures.push(...assertTurn(sc, t).map(f => `第${turns.length}轮：${f}`))
    }
  } finally {
    try { session.close() } catch { /* ignore */ }
  }

  const { score, verdict } = await judge(sc, turns)
  return { scenarioId: sc.id, tag: sc.tag, passed: failures.length === 0, score, verdict, turns, failures, ms: Date.now() - t0 }
}

export async function runSelfTest(opts: {
  runId: number
  kind: 'brain' | 'live'
  only?: string[]
  model?: string
}): Promise<void> {
  const picked = opts.only?.length ? SCENARIOS.filter(s => opts.only!.includes(s.id)) : SCENARIOS
  const model = opts.model || LIVE_AUDIO
  let passed = 0
  const scores: number[] = []

  try {
    for (const sc of picked) {
      let r: CaseResult
      try {
        r = opts.kind === 'live' ? await runLiveCase(sc, model) : await runBrainCase(sc)
      } catch (e) {
        // 单条挂掉不该让整轮作废 —— 记成失败继续。
        r = {
          scenarioId: sc.id, tag: sc.tag, passed: false, score: 0,
          verdict: `用例执行异常：${(e as Error)?.message || e}`,
          turns: [], failures: ['用例执行异常'], ms: 0,
        }
      }
      if (r.passed) passed++
      if (r.score) scores.push(r.score)
      await pool.query(
        `INSERT INTO luna_test_cases (run_id, scenario_id, tag, passed, score, verdict, turns, failures, ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [opts.runId, r.scenarioId, r.tag, r.passed, r.score, r.verdict,
         JSON.stringify(r.turns), r.failures.length ? r.failures : null, r.ms]
      ).catch(e => console.warn('[SelfTest] case insert failed:', e?.message))
    }

    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    await pool.query(
      `UPDATE luna_test_runs SET status='done', finished_at=now(), passed=$2, total=$3, avg_score=$4 WHERE id=$1`,
      [opts.runId, passed, picked.length, avg]
    )
    console.log(`[SelfTest] run ${opts.runId} done — ${passed}/${picked.length}, avg ${avg?.toFixed(2) ?? '-'}`)
  } catch (e) {
    await pool.query(
      `UPDATE luna_test_runs SET status='failed', finished_at=now(), error=$2 WHERE id=$1`,
      [opts.runId, String((e as Error)?.message || e).slice(0, 500)]
    ).catch(() => {})
    console.error('[SelfTest] run failed:', e)
  }
}
