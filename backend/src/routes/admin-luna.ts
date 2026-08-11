/**
 * Admin · Luna 可观测 + 自测 API
 *
 * ## 为什么存在
 *
 * 2026-08-10 owner 报了两个故障（「AI 说自己能卖二手房」「说完话等一分钟」），
 * 而我**查不到任何证据**：`luna_sessions` 只在 `endSession` 时上报（实测 12 小时
 * 0 行，人明明用过），延迟只进 `console.log`，测试全是 CLI、结果不落库。
 *
 * 结论是 owner 的原话：**「要一个完整 admin 能人手或者 AI 直接测试的系统，
 * 并能根据 live chat 完整知道体验 —— 客户说话到 AI 回话隔了多久、回了什么。」**
 *
 * 这个文件就是那套东西的后端。三块：
 *   1. `GET /sessions` `/session/:id` —— 真实会话逐轮时间线（延迟 + 说了什么 + 有没有问 Brain）
 *   2. `POST /test` `GET /tests` `/test/:id` —— 一键自测，人手能点、AI 也能调
 *   3. 指标 `GET /health` —— 三个核心数一眼看完
 *
 * ## 最重要的那个数：`asked_brain`
 *
 * `source='live'` 有而 `asked_brain=false` 的轮次 = **Luna 没查就自己说了**。
 * 所有护栏（数据边界/诚实规则/澄清出路）都在 Brain 里，绕过 Brain = 护栏全失效。
 * 二手房那句就是这么冒出来的。这是唯一能量化「Live 有多不听话」的指标。
 */
import { Router } from 'express'
import pool from '../db/pool'
import { requireAdmin } from '../middleware/auth'
import { runSelfTest, listScenarios } from '../services/luna-self-test'

const router = Router()
router.use(requireAdmin)

/** GET /api/admin/luna/health —— 三个核心数。 */
router.get('/health', async (req, res) => {
  const days = Math.min(parseInt(String(req.query.days || '7')) || 7, 90)
  try {
    const { rows } = await pool.query(
      `SELECT
         count(*) FILTER (WHERE source = 'live')                              AS spoken_turns,
         count(*) FILTER (WHERE source = 'live' AND asked_brain IS FALSE)     AS unchecked_turns,
         count(*) FILTER (WHERE source = 'brain' AND degraded)                AS degraded_turns,
         count(*) FILTER (WHERE source = 'brain' AND clarifying)              AS clarifying_turns,
         count(DISTINCT session_id)                                           AS sessions,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY to_first_audio_ms)
               FILTER (WHERE to_first_audio_ms > 0))                          AS p50_first_audio_ms,
         round(percentile_cont(0.95) WITHIN GROUP (ORDER BY to_first_audio_ms)
               FILTER (WHERE to_first_audio_ms > 0))                          AS p95_first_audio_ms,
         round(avg(ms) FILTER (WHERE source = 'brain'))                       AS avg_brain_ms
       FROM luna_turns
       WHERE created_at > now() - ($1 || ' days')::interval`,
      [String(days)]
    )
    res.json({ days, ...rows[0] })
  } catch (e) {
    console.error('[AdminLuna] health failed:', e)
    res.status(500).json({ error: 'query failed' })
  }
})

/** GET /api/admin/luna/sessions —— 会话列表（逐轮表聚合，不依赖 endSession）。 */
router.get('/sessions', async (req, res) => {
  const days = Math.min(parseInt(String(req.query.days || '14')) || 14, 90)
  const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200)
  try {
    const { rows } = await pool.query(
      `SELECT
         session_id,
         min(created_at)                                                AS started_at,
         max(created_at)                                                AS last_at,
         count(*) FILTER (WHERE source = 'live')                        AS turns,
         count(*) FILTER (WHERE source = 'live' AND asked_brain IS FALSE) AS unchecked,
         count(*) FILTER (WHERE source = 'brain' AND degraded)          AS degraded,
         round(avg(to_first_audio_ms) FILTER (WHERE to_first_audio_ms > 0)) AS avg_first_audio_ms,
         max(to_first_audio_ms)                                         AS worst_first_audio_ms,
         array_remove(array_agg(DISTINCT out_of_scope), NULL)           AS scopes,
         (array_agg(user_said ORDER BY created_at)
            FILTER (WHERE user_said IS NOT NULL AND user_said <> ''))[1] AS first_question
       FROM luna_turns
       WHERE created_at > now() - ($1 || ' days')::interval
         AND session_id IS NOT NULL
       GROUP BY session_id
       ORDER BY min(created_at) DESC
       LIMIT $2`,
      [String(days), limit]
    )
    res.json({ sessions: rows })
  } catch (e) {
    console.error('[AdminLuna] sessions failed:', e)
    res.status(500).json({ error: 'query failed' })
  }
})

/** GET /api/admin/luna/session/:id —— 一场会话的逐轮时间线。 */
router.get('/session/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, source, user_said, question, speech, tools, intended_tool,
              ms, user_speech_ms, to_first_audio_ms, total_ms,
              asked_brain, degraded, out_of_scope, clarifying
       FROM luna_turns WHERE session_id = $1 ORDER BY created_at ASC, id ASC`,
      [req.params.id]
    )
    res.json({ sessionId: req.params.id, turns: rows })
  } catch (e) {
    console.error('[AdminLuna] session failed:', e)
    res.status(500).json({ error: 'query failed' })
  }
})

/** GET /api/admin/luna/scenarios —— 可跑的测试场景（给前端画勾选框）。 */
router.get('/scenarios', (_req, res) => res.json({ scenarios: listScenarios() }))

/**
 * POST /api/admin/luna/test —— 触发一次自测。
 *
 * **立刻返回 runId，后台跑** —— 一整套要几分钟，HTTP 等不住。
 * 前端轮询 `/test/:id` 看进度。AI（我）也走同一个接口，
 * 所以「人手测」和「AI 测」是同一条路径，不会两套结果对不上。
 */
router.post('/test', async (req, res) => {
  const { kind = 'brain', only, model } = req.body || {}
  if (!['brain', 'live'].includes(kind)) {
    return res.status(400).json({ error: "kind must be 'brain' or 'live'" })
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO luna_test_runs (kind, model, status, triggered_by) VALUES ($1,$2,'running',$3) RETURNING id`,
      [kind, model || null, req.ctx?.email || 'admin']
    )
    const runId = rows[0].id
    // 后台跑，不 await —— 失败也已被 runSelfTest 内部吞掉并写进 run.error。
    runSelfTest({ runId, kind, only, model }).catch((e: unknown) =>
      console.error('[AdminLuna] self-test crashed:', e)
    )
    res.json({ runId, status: 'running' })
  } catch (e) {
    console.error('[AdminLuna] test trigger failed:', e)
    res.status(500).json({ error: 'could not start test' })
  }
})

/** GET /api/admin/luna/tests —— 历史（含趋势对比）。 */
router.get('/tests', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, finished_at, kind, model, status, triggered_by,
              passed, total, avg_score, error
       FROM luna_test_runs ORDER BY id DESC LIMIT 30`
    )
    res.json({ runs: rows })
  } catch (e) {
    console.error('[AdminLuna] tests failed:', e)
    res.status(500).json({ error: 'query failed' })
  }
})

/** GET /api/admin/luna/test/:id —— 一次运行的逐条结果。 */
router.get('/test/:id', async (req, res) => {
  try {
    const run = await pool.query(`SELECT * FROM luna_test_runs WHERE id = $1`, [req.params.id])
    if (!run.rows.length) return res.status(404).json({ error: 'not found' })
    const cases = await pool.query(
      `SELECT scenario_id, tag, passed, score, verdict, turns, failures, ms
       FROM luna_test_cases WHERE run_id = $1 ORDER BY id ASC`,
      [req.params.id]
    )
    res.json({ run: run.rows[0], cases: cases.rows })
  } catch (e) {
    console.error('[AdminLuna] test detail failed:', e)
    res.status(500).json({ error: 'query failed' })
  }
})

export default router
