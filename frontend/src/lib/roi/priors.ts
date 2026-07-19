/**
 * ROI 模拟器的**数据先验** —— 这是我们和对手唯一的实质差别。
 *
 * 对手(m37 remc)六个输入全靠用户瞎填。我们能用真实数据填三项:
 *   购房总价      ← project_unit_types.price                      🔵 实测
 *   维护费率      ← residential_projects.service_charge_per_sqft   🔵 实测(逐项目)
 *   租金收益率    ← 区域中位新签租金 ÷ 中位成交价(DLD)            🔵 实测
 * 剩下三项(利率/首付/空置率)诚实标成假设。
 *
 * ⚠️ 房价涨幅是个陷阱,必须正面处理:
 *   我们只有 2021–2025,而这恰好是迪拜史上最猛的后疫情暴涨段。拿它当未来先验会
 *   **系统性高估,而且是朝着让客户下单的方向高估**。所以:
 *     · 默认值 = CONSERVATIVE_GROWTH_PCT(3%),不是历史值
 *     · 历史值只放在一个「用本区历史值填入」按钮后面,点了才用
 *     · 按钮旁必须有繁荣期警示
 *   见 docs/map-timeline-and-roi-calculator-spec.md §③ 与 [[luna-tour-audit-2026-07-12]]。
 *
 * ⚠️ 空置率我们**完全没有数据** —— Ejari 只记签成的约,签不出去的房子不会进库。
 *   永远标 'assumption',绝不伪装成实测。
 */
import { API_BASE_URL } from '../config'
import { fetchProjectInsights, fetchAreaInsights, fetchAreaInvestment } from '../api'

const API_URL = `${API_BASE_URL}/api`

/** 每个数字的出处。UI 必须逐项渲染徽章 —— 这是硬要求,不是装饰。 */
export type SourceKind = 'dld' | 'assumption'

/** 保守涨幅默认值。**不要**改成历史均值。 */
export const CONSERVATIVE_GROWTH_PCT = 3

/** 涨幅波动率默认值(σ)。迪拜年度波动很大,给宽一点比给窄了诚实。 */
export const DEFAULT_GROWTH_SD_PCT = 8

/** 空置率默认均值 —— 纯假设(迪拜住宅一般讨论 5–12%)。 */
export const DEFAULT_VACANCY_MEAN_PCT = 8

/** 对手默认的 1.5% 维护费率 —— 只在我们拿不到 service_charge 时才用,并标为假设。 */
export const FALLBACK_MAINTENANCE_PCT = 1.5

export interface RoiProjectHit {
  id: string
  project_name: string | null
  area: string | null
  developer: string | null
  primary_image: string | null
  min_price: number | null
}

export interface RoiUnit {
  id: string
  unit_type_name: string
  bedrooms: number | null
  /** pg NUMERIC 回传的是**字符串**,这里已 Number() 过 */
  bathrooms: number | null
  /** sqft(开发商数据本来就是 sqft) */
  area: number | null
  builtUpArea: number | null
  price: number | null
  pricePerSqft: number | null
}

export interface RoiProject {
  id: string
  name: string
  area: string | null
  developer: string | null
  /** AED/sqft/年;null = 该项目楼书没给 */
  serviceChargePerSqft: number | null
  units: RoiUnit[]
}

export interface RoiPriors {
  areaId: string | null
  areaName: string | null
  /** 区域毛回报 %(DLD 实测);null = 样本不足 */
  yieldPct: number | null
  yieldConfidence: 'high' | 'medium' | 'low' | null
  rentCount: number | null
  /** 年化历史涨幅 %(由累计涨幅换算);⚠️ 属繁荣期,默认不采用 */
  historicalGrowthPct: number | null
  /** 历史涨幅取自哪个窗口 */
  historicalWindow: '3y' | '2y' | '1y' | null
  dataThrough: string | null
  /**
   * 片区 OA 物业费 AED/sqft/年(DLD dld_service_charges,9.1 万行 / 63 个社区)。
   * ⚠️ 项目级 residential_projects.service_charge_per_sqft **目前 46 个项目全是 NULL**
   * (楼书文本层还没抽到),所以这条片区级实测值是当下唯一能真正落地的物业费来源。
   * 项目级一旦有值优先用项目级 —— 逐项目 > 片区中位。
   */
  areaServiceChargePerSqft: number | null
}

/** 维护费率这个数是怎么来的 —— 决定徽章文案,别混。 */
export type MaintenanceOrigin = 'project' | 'area' | 'assumption'

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 公开(免登录)项目自动补全。走 `/api/residential-projects/search`,
 * **不是** agent 命名空间下那个 —— 后者要经纪身份,且服务端按 IP 限流(429)。
 */
export async function searchProjectsPublic(q: string, signal?: AbortSignal): Promise<RoiProjectHit[]> {
  const s = q.trim()
  if (s.length < 2) return []
  const r = await fetch(`${API_URL}/residential-projects/search?q=${encodeURIComponent(s)}`, { signal })
  if (r.status === 429) throw new Error('rate_limited')
  if (!r.ok) return []
  const j = await r.json()
  return (j.projects || []) as RoiProjectHit[]
}

/**
 * 取项目 + 户型。
 * ⚠️ 响应里的 key 是 `project.units`(不是 unitTypes),字段 snake_case,
 *    且 bathrooms/area/built_up_area 是 **string**(pg NUMERIC 回传文本)。
 */
export async function fetchRoiProject(id: string): Promise<RoiProject | null> {
  try {
    const r = await fetch(`${API_URL}/residential-projects/${encodeURIComponent(id)}`)
    if (!r.ok) return null
    const j = await r.json()
    const p = j?.project
    if (!p) return null
    const units: RoiUnit[] = (p.units || []).map((u: Record<string, unknown>) => ({
      id: String(u.id),
      unit_type_name: String(u.unit_type_name || ''),
      bedrooms: num(u.bedrooms),
      bathrooms: num(u.bathrooms),
      area: num(u.area),
      builtUpArea: num(u.built_up_area),
      price: num(u.price),
      pricePerSqft: num(u.price_per_sqft),
    }))
    return {
      id: String(p.id),
      name: String(p.project_name || ''),
      area: p.area ?? null,
      developer: p.developer ?? null,
      serviceChargePerSqft: num(p.service_charge_per_sqft),
      units,
    }
  } catch {
    return null
  }
}

/** 累计涨幅 → 年化。(1+cum)^(1/years) − 1 */
function annualize(cumulativePct: number, years: number): number {
  const r = Math.pow(1 + cumulativePct / 100, 1 / years) - 1
  return Number((r * 100).toFixed(2))
}

/**
 * 项目 → 区域先验(回报 + 历史涨幅)。
 * 回报走现有 netYield 链路(projectInsights.area.rental_yield_pct);
 * 涨幅走 area-insights 的 appreciation 窗口,优先 3y(样本厚、噪声小),
 * 逐级回退 2y/1y,并**年化**后返回。
 */
export async function fetchRoiPriors(projectId: string, areaName?: string | null): Promise<RoiPriors> {
  const empty: RoiPriors = {
    areaId: null,
    areaName: null,
    yieldPct: null,
    yieldConfidence: null,
    rentCount: null,
    historicalGrowthPct: null,
    historicalWindow: null,
    dataThrough: null,
    areaServiceChargePerSqft: null,
  }
  const [insights, investment] = await Promise.all([
    fetchProjectInsights(projectId).catch(() => null),
    areaName ? fetchAreaInvestment(areaName).catch(() => null) : Promise.resolve(null),
  ])
  empty.areaServiceChargePerSqft = investment?.service_charge_sqft ?? null
  const area = insights?.area
  if (!area) return empty

  const base: RoiPriors = {
    ...empty,
    areaId: area.id,
    areaName: area.name,
    yieldPct: area.rental_yield_pct ?? null,
    yieldConfidence: area.confidence ?? null,
    rentCount: area.rent_count ?? null,
    dataThrough: area.data_through ?? null,
  }
  if (!area.id) return base

  const ai = await fetchAreaInsights(area.id).catch(() => null)
  const app = ai?.appreciation
  if (app) {
    const tries: { k: '3y' | '2y' | '1y'; years: number }[] = [
      { k: '3y', years: 3 },
      { k: '2y', years: 2 },
      { k: '1y', years: 1 },
    ]
    for (const t of tries) {
      const v = app[t.k]
      if (v != null) {
        base.historicalGrowthPct = annualize(v, t.years)
        base.historicalWindow = t.k
        break
      }
    }
  }
  if (ai?.dataThrough) base.dataThrough = ai.dataThrough
  return base
}

/**
 * 维护费率 % = service_charge_per_sqft × 面积(sqft) ÷ 总价 × 100。
 * 三个数缺任何一个都返回 null —— 调用方据此回退到假设值并改徽章。
 */
export function maintenancePctFromServiceCharge(
  serviceChargePerSqft: number | null,
  areaSqft: number | null,
  price: number | null
): number | null {
  if (!serviceChargePerSqft || !areaSqft || !price || price <= 0) return null
  const pct = ((serviceChargePerSqft * areaSqft) / price) * 100
  if (!Number.isFinite(pct) || pct <= 0 || pct > 15) return null // >15% 必是脏数据
  return Number(pct.toFixed(2))
}

/**
 * 维护费率的取值链:**逐项目实测 → 片区 DLD 实测 → 假设 1.5%**。
 * 前两档都算 🔵 实测,但 detail 文案必须说清是项目级还是片区级 —— 片区中位数
 * 套到具体一套房上是有误差的,不能让人以为这就是他这套的账单。
 */
export function resolveMaintenance(
  projectServiceCharge: number | null,
  areaServiceCharge: number | null,
  areaSqft: number | null,
  price: number | null
): { pct: number; origin: MaintenanceOrigin; perSqft: number | null } {
  const fromProject = maintenancePctFromServiceCharge(projectServiceCharge, areaSqft, price)
  if (fromProject != null) return { pct: fromProject, origin: 'project', perSqft: projectServiceCharge }
  const fromArea = maintenancePctFromServiceCharge(areaServiceCharge, areaSqft, price)
  if (fromArea != null) return { pct: fromArea, origin: 'area', perSqft: areaServiceCharge }
  return { pct: FALLBACK_MAINTENANCE_PCT, origin: 'assumption', perSqft: null }
}
