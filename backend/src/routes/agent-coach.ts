/**
 * 经纪产品教练 API —— `POST /api/agent/coach`
 *
 * 教经纪怎么用这个产品。与 Luna（房产顾问、语音、对客户）严格分开 ——
 * 见 `services/agent-coach.ts` 顶部。
 *
 * 需要登录（`requireAuth`）：它讲的是经纪台里的东西，未登录的人看了也用不上，
 * 而且 `isPro` 决定要不要提 Pro 功能。
 */
import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { askCoach } from '../services/agent-coach'

const router = Router()

router.post('/coach', requireAuth, async (req, res) => {
  const { question, language, path } = req.body || {}
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' })
  }
  /**
   * ⚠️ **不查订阅状态。** 曾想按 Pro/非 Pro 分别措辞，但订阅是另一套单一真相源
   * （`lt_subscriptions`），在这里另起一个查询就是又开一条会漂移的支路。
   *
   * 改法更简单也更稳:知识库每条本来就带 `audience`，让模型照实说
   * 「这个功能属于专业版」。经纪自己知道有没有买 —— 我们只要别让他
   * 白点一个用不了的按钮。
   */
  const out = await askCoach({ question: question.slice(0, 500), language, path })
  console.log(`[AgentCoach] "${question.slice(0, 50)}" → ${out.debug.ms}ms${out.debug.degraded ? ' DEGRADED' : ''}`)
  res.json(out)
})

export default router
