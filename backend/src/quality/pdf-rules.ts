/**
 * 楼书抽取的质检规则。
 *
 * 之前只知道「job 成功 / 失败」。但**一个"成功"的 job 完全可能什么都没抽出来** ——
 * 客户传了 200 页楼书,拿回一个空壳,而系统显示"处理完成"。
 *
 * 质量 = 抽全了没有、抽对了没有。这些规则就是把「成功」拆成可优化的维度:
 * 哪个字段最常缺、哪个抽取 agent 最常空手而归。
 */
import type { Rule } from './index'

/** executePdfWorkflow 的 buildingData。 */
type Building = any

interface Meta {
  totalPages?: number
}

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 某个字段在数组里的填充率。 */
function fillRate(rows: any[], key: string): number {
  if (!rows.length) return 0
  const filled = rows.filter((r) => r?.[key] !== null && r?.[key] !== undefined && r?.[key] !== '').length
  return Math.round((filled / rows.length) * 100)
}

export const PDF_RULES: Rule<Building>[] = [
  {
    id: 'has_units',
    severity: 'critical',
    why: '**客户买的是户型**。一份楼书解析出 0 个户型 = 这次上传对客户毫无价值(哪怕 job 显示"成功")。',
    check: (b) => {
      const n = (b?.units || []).length
      return n > 0 ? null : '抽出 0 个户型(这份楼书等于白传了)'
    },
  },
  {
    id: 'has_project_name',
    severity: 'critical',
    why: '没有项目名 = 这条数据没法入库、没法匹配、没法展示。',
    check: (b) => (String(b?.name || '').trim() ? null : '没有抽到项目名'),
  },
  {
    id: 'has_location',
    severity: 'major',
    why: '没有坐标 = **项目在地图上不存在**。而地图是整个产品的核心。',
    check: (b) => {
      // 真实字段名是 latitude / longitude(顶层)—— 实测确认,别猜
      const lat = num(b?.latitude)
      const lng = num(b?.longitude)
      return lat && lng ? null : '没有坐标(项目上不了地图)'
    },
  },
  {
    id: 'units_have_price',
    severity: 'major',
    why: '户型没价格 = **客户最想知道的那个数没了**(实测:客户在 Luna 里问「starting price」问了两遍,她答不上来)。\n' +
      '⚠️ 但这**通常不是抽取器的 bug** —— 2026-07-13 追到源 PDF 实测确认:迪拜楼书本来就不印价格' +
      '(Binghatti Wraith 的 44 页 brochure + 户型图,一个价格都没有),价格是**单独一张 price list**。\n' +
      '所以这条规则失败时,先看经纪**有没有传价格表**,而不是去改 pricing-extractor。' +
      '修法在上传环节(submit-readiness 的 priceWarning)。',
    check: (b) => {
      const units = b?.units || []
      if (!units.length) return null   // has_units 已经报过了
      const rate = fillRate(units, 'price')
      return rate >= 60 ? null
        : `只有 ${rate}% 的户型有价格(${units.length} 个户型)—— 多半是没传价格表`
    },
  },
  {
    id: 'units_have_area',
    severity: 'major',
    why: '面积和价格一样是刚需字段。缺了就算不出单价,投资分析全废。',
    check: (b) => {
      const units = b?.units || []
      if (!units.length) return null
      const rate = fillRate(units, 'area')   // 实测:字段就叫 area
      return rate >= 60 ? null : `只有 ${rate}% 的户型有面积`
    },
  },
  {
    id: 'has_payment_plan',
    severity: 'minor',
    why: '付款计划是期房的核心卖点(迪拜客户最关心的就是分期)。缺了不致命但会削弱说服力。',
    check: (b) => ((b?.paymentPlans || []).length > 0 ? null : '没有抽到付款计划'),
  },
  {
    id: 'has_images',
    severity: 'major',
    why: '没有图 = 卡片、tour、报告全是白的。楼书里一定有图,抽不到说明图片管线出了问题。',
    check: (b) => {
      const imgs = (b?.images?.projectImages || []).length + (b?.images?.floorPlanImages || []).length
      return imgs > 0 ? null : '一张图都没抽到(图片管线可能坏了)'
    },
  },
  {
    id: 'units_per_page_sane',
    severity: 'minor',
    why: '一份 100 页的楼书只抽出 1 个户型,多半是**户型页没被识别**(而不是真的只有一个户型)。这条是"抽漏了"的嗅探。',
    check: (b, meta) => {
      const pages = (meta as Meta)?.totalPages || 0
      const units = (b?.units || []).length
      if (pages < 20 || units === 0) return null
      return units >= 2 ? null : `${pages} 页楼书只抽出 ${units} 个户型(户型页可能没被识别)`
    },
  },
  {
    id: 'no_placeholder_text',
    severity: 'major',
    why: '模型编不出来时会写「暂无」「待定」「N/A」并当成真数据 —— 这些必须当成缺失,不能入库骗客户。',
    check: (b) => {
      const junk = ['暂无', '待定', 'N/A', 'TBD', 'Coming soon', 'null']
      const desc = String(b?.description || '')
      const hit = junk.filter((j) => desc.includes(j))
      return hit.length === 0 ? null : `项目描述里有占位文本:${hit.join(', ')}`
    },
  },
]
