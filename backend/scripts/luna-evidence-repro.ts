/**
 * 2026-08-13 生产事故的原样复现 —— 「废话多、实话少」那通电话。
 *
 * 事故 session:`voice_1786660799654_8qoieo`(26 句 / 392s)。owner 看完回放的原话:
 *   「烂大街的回复,我这种人都能编的出来,谁信你啊?要给 example 要列证据,
 *     比如说最近就哪哪哪卖出了房子。」
 *
 * 被点名的那句(第 9 轮),客户问的是「未来交付量大会不会压低成交价」:
 *   ❌「朱美拉村圈作为成熟社区,凭借其高性价比和便利的位置,一直有着非常强劲的
 *      本地自住和租赁需求来消化这些新增供应。」
 *
 * 它通过了当时**所有**诚实性检查 —— 因为一个数字都没编。它只是一句空话,
 * 而且方向和数据相反:同期 JVC 现房转售中位单价已从 2025Q4 的 14,553/㎡
 * 跌到 12,733/㎡,**连跌三季、回撤 12.5%**。
 *
 * 跑法(打生产 API,几分钱):
 *   cd backend && LUNA_TOOLS_API_BASE=https://api.pinzos.com \
 *     npx ts-node -T scripts/luna-evidence-repro.ts
 */
import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env') })

import { askLuna } from '../src/services/luna-brain'

/** 无据可依的定性形容词 —— 出现即扣分(除非同句挂着数字)。 */
const EMPTY_ADJECTIVES = [
  '非常强劲', '强劲的', '稳步上涨', '稳步上升', '非常可观', '极具潜力',
  '优质', '抗跌性', '保值属性', '非常高', '极高', '前景广阔',
]

interface Case {
  name: string
  question: string
  language?: string
  /** 必须出现的证据形态 */
  wants: { evidenceTool?: boolean; digits?: boolean; project?: boolean; downside?: boolean }
}

const CASES: Case[] = [
  {
    name: 'supply-pressure',   // ← 事故原句
    question: '他过去几年表现比较好,但是未来的交付量也比较高。那会不会影响JVC这个区域整体的未来成交价格呢?',
    language: 'zh',
    wants: { evidenceTool: true, digits: true, downside: true },
  },
  {
    name: 'which-areas-resilient',  // ← 事故第 13 轮:把 JVC 换个名字又推荐一遍
    question: '你说的抗跌性,哪些区域会更具有抗跌性?',
    language: 'zh',
    wants: { evidenceTool: true, digits: true },
  },
  {
    name: 'jvc-upside',        // ← 事故第 7 轮:「升值空间非常可观」,零证据
    question: 'JVC的升值空间怎么样?',
    language: 'zh',
    wants: { evidenceTool: true, digits: true, project: true },
  },
  {
    name: 'creek-harbour-en',
    question: 'how is Dubai Creek Harbour doing? is it holding its value?',
    wants: { evidenceTool: true, digits: true, project: true },
  },
]

const EVIDENCE_TOOLS = ['recent_transactions', 'price_trend']

;(async () => {
  console.log('\n2026-08-13 事故复现 —— 空话 vs 证据\n' + '─'.repeat(78))
  let pass = 0, fail = 0

  for (const c of CASES) {
    const a: any = await askLuna({ question: c.question, language: c.language, sessionId: `repro_${c.name}` })
    const speech: string = a.speech || ''
    const tools: string[] = (a.debug?.toolLog || []).map((t: any) => t.name || t)

    const usedEvidence = tools.some(t => EVIDENCE_TOOLS.includes(t))
    /**
     * 数字检测必须认三种写法 —— 这是**语音**稿,提示词明令「像人一样念金额」,
     * 所以英文里数字本来就该拼成词。只认阿拉伯数字会把一条满是证据的
     * 英文回答误判成「一个数字都没有」(我第一版就是这么冤枉它的)。
     */
    const hasDigits = /\d/.test(speech)
      || /[一二三四五六七八九十百千万]{3,}/.test(speech)
      || /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million)\b/i.test(speech)
    // 项目名:拉丁字母串(项目名全是英文)
    const hasProject = /[A-Za-z][A-Za-z\s'&.-]{4,}/.test(speech)
    const downside = /跌|回撤|下行|下降|放缓|压力|回调|风险|falling|down|drop|pressure|softer|cooled/i.test(speech)
    const emptyHits = EMPTY_ADJECTIVES.filter(w => speech.includes(w))

    const probs: string[] = []
    if (c.wants.evidenceTool && !usedEvidence) probs.push('没调举证工具')
    if (c.wants.digits && !hasDigits) probs.push('一个数字都没有')
    if (c.wants.project && !hasProject) probs.push('没点名任何项目')
    if (c.wants.downside && !downside) probs.push('🔴 回避了下行事实')
    if (emptyHits.length >= 3) probs.push(`空话形容词 ${emptyHits.length} 个:${emptyHits.join('/')}`)
    // speech 是逐字朗读稿:星号/井号会被念出来。由 stripMarkup() 兜底,这里守着别复发。
    if (/\*\*|^#{1,6}\s|^\s*[-*+]\s/m.test(speech)) probs.push('🔴 markdown 泄漏进朗读稿')

    const ok = probs.length === 0
    ok ? pass++ : fail++
    console.log(`\n${ok ? '✅' : '❌'} ${c.name}   [${tools.join(',') || '无工具'}]`)
    console.log(`   Q: ${c.question}`)
    console.log(`   A: ${speech}`)
    if (probs.length) console.log(`   ⚠️  ${probs.join(' · ')}`)
  }

  console.log('\n' + '─'.repeat(78))
  console.log(`${pass}/${CASES.length} 通过${fail ? `,${fail} 条仍在说空话` : ''}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERR', e); process.exit(1) })
