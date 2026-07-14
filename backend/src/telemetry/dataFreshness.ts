/**
 * telemetry/dataFreshness — DLD 数据断更告警。
 *
 * WHY(2026-07-14):成交数据断了 **6 天**,是 owner 肉眼看前端截图发现的。
 * `scripts/check-dubai-freshness.ts` 那个 watchdog 判断是对的,但它只 exit 1,
 * **没接任何通道、没人在跑它** —— 等于不存在。这里把它接进现成的告警系统:
 * defineAlert 注册即生效 → 邮件 + Admin「错误监控」tab 全部白嫖。
 *
 * 🔴 核心:必须区分**两种完全不同的故障**,否则告警是误导的 ——
 * 老 watchdog 无论哪种都喊 "the daily sync likely did not run",而 07-14 那次
 * 同步明明跑了、是 DLD 源头停发,照着它去查会一路查错方向。
 *
 *   DLD_SYNC_DEAD    我们的锅:迪拜盒子上的 dubai-daily.timer 没跑完/挂了 → 去修
 *   DLD_SOURCE_STALE 源头的锅:我们天天在拉,DLD 就是没发新数据 → 等它,别改代码
 *
 * 怎么分辨的:
 *   - `max(load_timestamp)` 是**源 API 自带的字段**(不是入库时间)= 源头最后发布时间。
 *   - `max(market_cache.updated_at)` = daily 跑到最后一步(precompute)的时间 = **我们跑完了的心跳**。
 *     (盒子上的 rebuild+swap 流程不写 sync_runs,这是现成的、零改动的心跳信号。)
 *   两者一交叉:同步跑了 + 数据还是旧的 → 只可能是源头没发。
 *
 * ⚠️ 别用 rent 的 `start_date` 判断新鲜度 —— 那是**起租日,可以是未来**(合同提前签)。
 * 07-14 那次 rent 的 start_date 最大值到 07-13,看着像"只有成交断了",实际两张表
 * 在同一分钟一起断的。新鲜度只认 load_timestamp。见 [[dld-freshness-load-timestamp]]。
 */
import pool from '../db/pool'
import { gauge } from './metrics'
import { defineAlert } from './alerts'

/** 阈值对齐各数据集的真实发布节奏(和 check-dubai-freshness.ts 一致)。 */
const TX_MAX_AGE_H = 36    // 成交日更 → 36h 抓一次漏天
const RENT_MAX_AGE_H = 120 // Ejari 是**批次**发布(每隔几天一批),不是日更 → 120h 才算真卡住
const SYNC_MAX_AGE_H = 36  // daily timer 每天 02:00 跑;超 36h 没跑完 = 它死了

/** 15 分钟缓存 —— 数据新鲜度是「天」级的事,没必要频繁查库(告警每分钟读一次这个缓存)。 */
let cache = { at: 0, txAgeH: 0, rentAgeH: 0, syncAgeH: 0 }

async function refresh(): Promise<void> {
  if (Date.now() - cache.at < 15 * 60 * 1000) return
  try {
    const { rows } = await pool.query<{ tx_h: string | null; rent_h: string | null; sync_h: string | null }>(
      `SELECT
         (SELECT EXTRACT(EPOCH FROM (now() - max(load_timestamp))) / 3600 FROM dld_transactions)   AS tx_h,
         (SELECT EXTRACT(EPOCH FROM (now() - max(load_timestamp))) / 3600 FROM dld_rent_contracts) AS rent_h,
         (SELECT EXTRACT(EPOCH FROM (now() - max(updated_at)))     / 3600 FROM market_cache)       AS sync_h`
    )
    const r = rows[0]
    cache = {
      at: Date.now(),
      txAgeH: Math.round(Number(r?.tx_h || 0)),
      rentAgeH: Math.round(Number(r?.rent_h || 0)),
      syncAgeH: Math.round(Number(r?.sync_h || 0)),
    }
  } catch {
    /* DB 抖动不该把告警系统带崩 —— 保留上一轮的值 */
  }
}

/** 同步跑完过 = 数据陈旧不是我们的锅。两条「源头」告警都拿它做前提。 */
const syncAlive = () => cache.syncAgeH <= SYNC_MAX_AGE_H

const d = (h: number) => `${Math.floor(h / 24)} 天`

let started = false

export function startDataFreshnessTelemetry(): void {
  if (started) return
  started = true

  void refresh()
  setInterval(() => { void refresh() }, 15 * 60 * 1000).unref?.()

  gauge('dld.tx.age_h', () => cache.txAgeH)
  gauge('dld.rent.age_h', () => cache.rentAgeH)
  gauge('dld.sync.age_h', () => cache.syncAgeH)

  // ── 我们的锅 ───────────────────────────────────────────────────────
  defineAlert({
    kind: 'DLD_SYNC_DEAD',
    severity: 'error',
    threshold: SYNC_MAX_AGE_H,
    read: () => cache.syncAgeH,
    breach: (v) => v > SYNC_MAX_AGE_H,
    message: (v) =>
      `🔴 迪拜数据同步 ${v} 小时没跑完了(正常每天 02:00 CST 一次)—— **这是我们的锅**,不是源头。` +
      `去盒子看:ssh -i ~/.ssh/dubai_proxy root@38.54.8.9 "systemctl status dubai-daily.service; tail -40 /opt/dubai-sync/daily.log"`,
    recovered: () => '迪拜数据同步已恢复正常。',
  })

  // ── 源头的锅 ───────────────────────────────────────────────────────
  // 前提是 syncAlive():同步跑了还拿不到新数据 → DLD 自己停发了,改代码没用。
  defineAlert({
    kind: 'DLD_SOURCE_STALE',
    severity: 'warn',
    threshold: TX_MAX_AGE_H,
    read: () => (syncAlive() ? cache.txAgeH : 0), // 同步死了就交给 DLD_SYNC_DEAD 报,别重复告警
    breach: (v) => v > TX_MAX_AGE_H,
    message: (v) =>
      `⚠️ DLD 官方已 ${d(v)}(${v}h)没发布新成交数据了 —— 我们的同步每天照跑,拉不到东西,` +
      `**是源头停更,不是我们坏了**。前端会显示"数据截至"日期,不用改代码;真断很久就该找 DLD 问。`,
    recovered: () => 'DLD 成交数据恢复发布了。',
  })

  defineAlert({
    kind: 'DLD_RENT_SOURCE_STALE',
    severity: 'warn',
    threshold: RENT_MAX_AGE_H,
    read: () => (syncAlive() ? cache.rentAgeH : 0),
    breach: (v) => v > RENT_MAX_AGE_H,
    // Ejari 本来就是批次发,阈值放到 120h 才不会天天误报。
    message: (v) =>
      `⚠️ DLD 官方已 ${d(v)}(${v}h)没发布新租约(Ejari)数据了。Ejari 本就是批次发布(每隔几天一批),` +
      `但超过 5 天 = 真卡住了。同步侧正常,是源头停更。`,
    recovered: () => 'DLD 租约数据恢复发布了。',
  })
}
