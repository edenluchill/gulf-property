/**
 * Luna Tour 的质检规则 —— **从 tour-e2e.ts 搬进生产**。
 *
 * 那 24 条规则本来就存在,而且很好(每一条都是踩过坑换来的),但它们**只在手动跑
 * 测试脚本时执行**。生产每天生成的真实 tour 从来没被体检过 —— 我们对真实输出的
 * 质量一无所知。现在每次生成完自动跑,分数和问题落 quality_samples。
 *
 * 每条规则都写了 `why` —— 这些不是拍脑袋的断言,是血泪:
 * 「户型卡不带数字」是因为**只要让模型填数字它就会编**。
 */
import type { Rule } from './index'

/** 生成后的 tour 剧本(结构见 tour-script.types.ts)。 */
type Script = any

interface Meta {
  /** 这场 tour 涉及的项目,以及每个项目**实际有几个户型**(用来判断"户型有没有缺席")。 */
  projects?: { id: string; name: string; units: number }[]
}

const beatsOf = (s: Script): any[] =>
  [s?.intro, ...(s?.acts || []).flatMap((a: any) => a?.beats || []), s?.outro].filter(Boolean)

const camsOf = (s: Script): any[] => beatsOf(s).flatMap((b: any) => b?.camera || [])

/** 数字看起来像"原始数据"(念出来像机器人):1234567 / 4.7328 之类 */
const RAW_NUMBER = /\b\d{6,}\b|\b\d+\.\d{3,}\b/

export const TOUR_RULES: Rule<Script>[] = [
  // ── 结构 ────────────────────────────────────────────────────────────
  {
    id: 'acts_match_projects',
    severity: 'critical',
    why: '一个项目一幕。数量对不上说明生成时丢了项目 —— 经纪选了 3 个盘,客户只看到 2 个。',
    check: (s, meta) => {
      const want = (meta as Meta)?.projects?.length
      const got = (s?.acts || []).length
      if (!want) return null
      return got === want ? null : `幕数 ${got} ≠ 项目数 ${want}(有项目被丢了)`
    },
  },
  {
    id: 'homes_beat_present',
    severity: 'critical',
    why: '**客户要买的是户型**。有户型数据却不讲户型,这场带看就是废的。',
    check: (s, meta) => {
      const projects = (meta as Meta)?.projects || []
      const withUnits = projects.filter((p) => p.units > 0).length
      if (!withUnits) return null
      const homesActs = (s?.acts || []).filter((a: any) =>
        (a?.beats || []).some((b: any) => b?.kind === 'homes')).length
      return homesActs >= withUnits ? null
        : `${withUnits} 个项目有户型数据,只有 ${homesActs} 个讲了户型`
    },
  },

  // ── 幻觉(最要命)────────────────────────────────────────────────────
  {
    id: 'unit_card_no_numbers',
    severity: 'critical',
    why: '**只要让模型填数字它就会编。** 户型卡的面积/价格必须由代码从 DB 填,不能进 prompt。',
    check: (s) => {
      const cards = beatsOf(s).flatMap((b: any) => b?.overlays || [])
        .filter((o: any) => o?.type === 'unit_card')
      const bad = cards.filter((o: any) => 'area_sqft' in o || 'price' in o)
      return bad.length === 0 ? null : `${bad.length} 张户型卡带了数字(模型会编)`
    },
  },
  {
    id: 'no_raw_numbers_in_speech',
    severity: 'major',
    why: '旁白里出现原始数字(1234567 / 4.7328)= 念出来像机器人。数字要说人话(「一百二十万」)。',
    check: (s) => {
      const bad = beatsOf(s)
        .filter((b: any) => typeof b?.narration === 'string' && RAW_NUMBER.test(b.narration))
        .map((b: any) => b.id)
      return bad.length === 0 ? null : `${bad.length} 拍旁白里有原始数字:${bad.slice(0, 3).join(', ')}`
    },
  },

  // ── 运镜(管的不是"动不动",是"动得有没有道理")─────────────────────
  {
    id: 'travel_shots_short',
    severity: 'major',
    why: '飞越途中没有信息,是**死时间**。移动必须短。',
    check: (s) => {
      const long = camsOf(s).filter((c: any) =>
        (c?.type === 'flyover' || (!c?.type && Array.isArray(c?.center))) && (c?.duration_ms ?? 0) > 2500)
      return long.length === 0 ? null
        : `${long.length} 个移动镜头 >2.5 秒(飞越途中是死时间)`
    },
  },
  {
    id: 'numbers_beat_static',
    severity: 'major',
    why: '客户在**读图表**,这时候动镜头就是跟数字抢注意力。',
    check: (s) => {
      const moving = (s?.acts || []).flatMap((a: any) => (a?.beats || [])
        .filter((b: any) => b?.kind === 'numbers' &&
          (b?.camera || []).some((c: any) => c?.type === 'orbit' || c?.type === 'flyover')))
      return moving.length === 0 ? null
        : `${moving.length} 个 numbers 拍在动镜头(读数字时别抢注意力)`
    },
  },
  {
    id: 'show_beats_have_motion',
    severity: 'minor',
    why: 'life / homes 拍正是「让他看清周围」的地方 —— 镜头完全不动就没有电影感。(上一轮为了修「乱飘」把镜头全按死,owner 说「动能太少」。)',
    check: (s) => {
      const show = (s?.acts || []).flatMap((a: any) => (a?.beats || [])
        .filter((b: any) => b?.kind === 'life' || b?.kind === 'homes'))
      if (!show.length) return null
      const frozen = show.filter((b: any) => !(b?.camera || []).length)
      return frozen.length === 0 ? null : `${frozen.length}/${show.length} 个 life/homes 拍完全没有运镜`
    },
  },
  {
    id: 'keyframe_no_bearing',
    severity: 'minor',
    why: '旋转只能来自显式的 orbit,不能靠 keyframe 的 bearing 漂移 —— 那会让镜头无缘无故地转。',
    check: (s) => {
      const cams = camsOf(s)
      const spun = cams.filter((c: any, i: number) => i > 0 && !c?.type && typeof c?.bearing === 'number')
      return spun.length === 0 ? null : `${spun.length} 个 keyframe 写了 bearing(旋转应来自 orbit)`
    },
  },

  // ── 呈现 ────────────────────────────────────────────────────────────
  {
    id: 'cards_not_late',
    severity: 'minor',
    why: '卡片迟到 = 客户对着一张空地图发呆。信息卡必须开场就在。',
    check: (s) => {
      const late = beatsOf(s).flatMap((b: any) => b?.overlays || [])
        .filter((o: any) => ['property_card', 'roi_card', 'unit_card'].includes(o?.type) && (o?.at_ms ?? 0) > 0)
      return late.length === 0 ? null : `${late.length} 张信息卡迟到(at_ms > 0)`
    },
  },
  {
    id: 'narration_not_empty',
    severity: 'critical',
    why: '没有旁白的拍 = 客户盯着地图听寂静。TTS 也没东西可念。',
    check: (s) => {
      const empty = beatsOf(s).filter((b: any) =>
        b?.kind !== 'transition' && !String(b?.narration || '').trim()).map((b: any) => b.id)
      return empty.length === 0 ? null : `${empty.length} 拍没有旁白:${empty.slice(0, 3).join(', ')}`
    },
  },
  {
    id: 'no_banned_phrases',
    severity: 'major',
    why: '「抱歉/对不起/无法」—— Luna 的人设是顾问,不是客服。出现这些词说明模型在道歉而不是在带看。',
    check: (s) => {
      const banned = ['抱歉', '对不起', '无法提供', '我不能']
      const bad = beatsOf(s).filter((b: any) =>
        banned.some((w) => String(b?.narration || '').includes(w))).map((b: any) => b.id)
      return bad.length === 0 ? null : `${bad.length} 拍出现禁用词(抱歉/无法):${bad.slice(0, 3).join(', ')}`
    },
  },
]
