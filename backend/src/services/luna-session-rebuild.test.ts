/**
 * `buildMessages` 的两个方向相反的失败模式。
 *
 * 生产数据只能验证其中一个 —— 所以这里两个都钉住：
 *   · 配对不够 → 客户每句话在回看页面上出现两遍（2026-08-14 实际发生过）
 *   · 配对过头 → 客户真的问了两遍被合并成一遍，而「重复提问」正是
 *     `luna-rules` 用来判「上一轮没答上」的痕迹，抹掉它 = 质检瞎了
 */
import { describe, it, expect, vi } from 'vitest'

// 这个模块为了跑 rebuild 会 import 数据库和 Gemini。单测只要那个纯函数，
// 别让它在 import 期就去连东西。
vi.mock('../db/pool', () => ({ default: { query: vi.fn() } }))
vi.mock('./lunaSummary', () => ({
  summarizeLunaSession: vi.fn(),
  hasSummarizableContent: vi.fn(() => false),
}))

import { buildMessages } from './luna-session-rebuild'

/** 造一行 luna_turns。t = 相对秒数。 */
const turn = (t: number, source: string, said: string, speech: string) => ({
  created_at: new Date(1_786_660_800_000 + t * 1000),
  source,
  question: null,
  speech,
  user_said: said,
  tools: null,
  degraded: null,
  ms: null,
  total_ms: null,
})

describe('buildMessages', () => {
  it('把同一轮的 brain/live 两行并成一问一答', () => {
    const msgs = buildMessages([
      turn(0, 'brain', '升值空间', 'JVC 年化 10.9%'),
      turn(23, 'live', '升值空间', 'JVC 年化 10.9%'),
    ])
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[0].content).toBe('升值空间')
  })

  it('live 那半没记到 speech 时，用 brain 的（首轮实测就是这样，曾导致重复）', () => {
    const msgs = buildMessages([
      turn(0, 'live', '¿Qué es esto?', ''),
      turn(3, 'brain', '¿Qué es esto?', 'I am Luna, your Dubai real estate consultant.'),
    ])
    expect(msgs).toHaveLength(2)
    expect(msgs[1].content).toContain('I am Luna')
  })

  it('两半的 speech 不一样时，以 live 说出口的那句为准', () => {
    const msgs = buildMessages([
      turn(0, 'brain', '预算 200 万', 'brain 写的稿子'),
      turn(10, 'live', '预算 200 万', 'live 真播出去的'),
    ])
    expect(msgs[1].content).toBe('live 真播出去的')
  })

  it('客户真的问了两遍 → 保留两轮，不许合并', () => {
    const msgs = buildMessages([
      turn(0, 'brain', '有没有二手房', '我们只做一手'),
      turn(20, 'live', '有没有二手房', '我们只做一手'),
      turn(40, 'brain', '有没有二手房', '抱歉，只有一手房源'),
      turn(60, 'live', '有没有二手房', '抱歉，只有一手房源'),
    ])
    expect(msgs.filter(m => m.role === 'user')).toHaveLength(2)
    expect(msgs.filter(m => m.role === 'assistant')).toHaveLength(2)
  })

  it('只有 brain 那一半（页面在 Luna 说完前就死了）照样保留', () => {
    const msgs = buildMessages([turn(0, 'brain', '再看看别墅', '好的，我查一下别墅')])
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant'])
  })

  it('隔太久的同一句不算同一轮', () => {
    const msgs = buildMessages([
      turn(0, 'brain', '升值空间', '答案 A'),
      turn(600, 'live', '升值空间', '答案 B'),
    ])
    expect(msgs.filter(m => m.role === 'user')).toHaveLength(2)
  })
})
