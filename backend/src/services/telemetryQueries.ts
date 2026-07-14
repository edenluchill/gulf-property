/**
 * Admin 读侧:遥测面板的数据源。
 *
 * 三块:
 *   1. 实时带看现状(WS 连接/房间/扇出/单核 CPU)—— 内存实时值 + 历史曲线
 *   2. 进房漏斗 —— 客户到底卡在哪一步
 *   3. 客户端 RUM + Agora 成本
 *
 * Agora 成本**不需要新采集** —— 数据早就在 lt_credit_ledger 里
 * (feature='live_call' 的 units)。1 unit = 1 Agora Standard 分钟 = $0.00099。
 */
import pool from '../db/pool'
import { peek, runtimeSnapshot, COLLAB_JOIN_STEPS } from '../telemetry'

/** Agora Standard 分钟单价(语音 1 unit;HD 视频 1 viewer-分钟 = 4 units)。 */
const AGORA_USD_PER_UNIT = 0.00099

/** 压测得出的单核天花板:1000 人同时带看 ≈ 105%。这里给 UI 画刻度线用。 */
export const CAPACITY = {
  cpuWarnPct: 75,
  note: '单进程单线程 —— 100% 即积压。压测:1000 人同时带看 ≈ 105%',
}

function metricNow(name: string): number | null {
  const hit = peek().find((s) => s.name === name)
  if (!hit) return null
  return hit.kind === 'gauge' ? (hit.value ?? null) : (hit.count ?? null)
}

/** 此刻(内存实时值,不查库)。 */
export function liveSnapshot() {
  const rt = runtimeSnapshot()
  return {
    wsConnections: metricNow('collab.ws.connections') ?? 0,
    activeRooms: metricNow('collab.rooms.active') ?? 0,
    cpuPct: rt.cpuPct,
    rssMb: rt.rssMb,
    loopLagMs: rt.loopLagMs,
    capacity: CAPACITY,
  }
}

/** 历史曲线:某个指标最近 N 分钟。gauge 取 value,counter 取 count。 */
export async function metricSeries(name: string, minutes = 180) {
  const { rows } = await pool.query(
    `SELECT minute, kind, count, value, p50, p95, max
       FROM metrics_minute
      WHERE name = $1 AND minute > now() - ($2 || ' minutes')::interval
      ORDER BY minute`,
    [name, String(minutes)]
  )
  return rows.map((r) => ({
    minute: r.minute,
    value: r.kind === 'gauge' ? Number(r.value ?? 0) : Number(r.count ?? 0),
    p50: r.p50 === null ? null : Number(r.p50),
    p95: r.p95 === null ? null : Number(r.p95),
    max: r.max === null ? null : Number(r.max),
  }))
}

/**
 * 进房漏斗:五步各有多少人走到。
 * 断崖处 = 客户卡住的地方(今天怀疑是「填称呼」那道身份门)。
 */
export async function joinFunnel(hours = 24) {
  const { rows } = await pool.query<{ step: string; n: string }>(
    `SELECT labels->>'step' AS step, SUM(count)::bigint AS n
       FROM metrics_minute
      WHERE name = 'funnel.collab.join'
        AND minute > now() - ($1 || ' hours')::interval
      GROUP BY 1`,
    [String(hours)]
  )
  const byStep = new Map(rows.map((r) => [r.step, Number(r.n)]))
  const first = byStep.get(COLLAB_JOIN_STEPS[0]) || 0
  return COLLAB_JOIN_STEPS.map((step, i) => {
    const n = byStep.get(step) || 0
    const prev = i === 0 ? n : (byStep.get(COLLAB_JOIN_STEPS[i - 1]) || 0)
    return {
      step,
      count: n,
      // 相对上一步的转化率 —— 断崖一眼可见
      fromPrevPct: prev > 0 ? Math.round((n / prev) * 100) : null,
      fromFirstPct: first > 0 ? Math.round((n / first) * 100) : null,
    }
  })
}

/** 客户端真实体验(RUM):p50 / p95。 */
export async function rumSummary(hours = 24) {
  const { rows } = await pool.query<{ name: string; samples: string; p50: number; p95: number }>(
    `SELECT name,
            SUM(count)::bigint                       AS samples,
            -- 各分钟的 p50/p95 再取中位/最大:够用的近似(不存原始样本)
            percentile_cont(0.5) WITHIN GROUP (ORDER BY p50) AS p50,
            MAX(p95)                                 AS p95
       FROM metrics_minute
      WHERE name LIKE 'rum.%' AND kind = 'histogram'
        AND minute > now() - ($1 || ' hours')::interval
      GROUP BY name
      ORDER BY name`,
    [String(hours)]
  )
  return rows.map((r) => ({
    name: r.name,
    samples: Number(r.samples),
    p50: Math.round(Number(r.p50 ?? 0)),
    p95: Math.round(Number(r.p95 ?? 0)),
  }))
}

/**
 * Agora 通话成本 —— **唯一真正花钱的东西**(WebSocket 同步的边际成本是 0)。
 * 参考:一场 4 人 30 分钟语音 ≈ $0.12;开视频是 4 倍。
 */
export async function agoraCost(days = 30) {
  const [totals, top] = await Promise.all([
    pool.query<{ day: string; units: string }>(
      `SELECT date_trunc('day', created_at)::date AS day, SUM(units)::bigint AS units
         FROM lt_credit_ledger
        WHERE feature = 'live_call' AND created_at > now() - ($1 || ' days')::interval
        GROUP BY 1 ORDER BY 1`,
      [String(days)]
    ),
    pool.query<{ email: string; units: string; credits: string }>(
      `SELECT a.email, SUM(l.units)::bigint AS units, SUM(l.credits)::bigint AS credits
         FROM lt_credit_ledger l JOIN lt_agents a ON a.id = l.agent_id
        WHERE l.feature = 'live_call' AND l.created_at > now() - ($1 || ' days')::interval
        GROUP BY a.email ORDER BY SUM(l.units) DESC LIMIT 10`,
      [String(days)]
    ),
  ])

  const daily = totals.rows.map((r) => ({
    day: r.day,
    units: Number(r.units),
    usd: Math.round(Number(r.units) * AGORA_USD_PER_UNIT * 100) / 100,
  }))
  const totalUnits = daily.reduce((a, b) => a + b.units, 0)

  return {
    days,
    totalUnits,
    totalUsd: Math.round(totalUnits * AGORA_USD_PER_UNIT * 100) / 100,
    usdPerUnit: AGORA_USD_PER_UNIT,
    daily,
    top: top.rows.map((r) => ({
      email: r.email,
      units: Number(r.units),
      credits: Number(r.credits),
      usd: Math.round(Number(r.units) * AGORA_USD_PER_UNIT * 100) / 100,
    })),
  }
}
