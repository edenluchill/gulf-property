/**
 * DB 活动采样器 —— **抓现行**。
 *
 * 用途:Hetzner 图上 CPU 飙到 100% 但**磁盘 IO 几乎为零**(= 纯计算,不是扫表),
 * 而 API 流量极轻。光看图猜不出是谁。这个脚本每秒采一次 pg_stat_activity,
 * 把**当时正在跑的查询**记下来。
 *
 * 没装 pg_stat_statements(要改 shared_preload_libraries + 重启 PG,进不去那台机器),
 * 所以只能靠采样。1 秒一次足够抓到跑几秒以上的查询。
 *
 * 用法:
 *   npx ts-node -T scripts/watch-db-activity.ts            # 一直采,Ctrl-C 停
 *   npx ts-node -T scripts/watch-db-activity.ts 600        # 采 600 秒后自动停
 *
 * 只打印**真正在跑**的查询(state=active、非本脚本自己),按累计出现次数排行。
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

import pool from '../src/db/pool'

const RUN_SECONDS = Number(process.argv[2] || 0)   // 0 = 一直跑

interface Hit {
  query: string
  seen: number          // 被采样到几次(≈ 累计占用秒数)
  maxDurationS: number
  app: string
  lastSeen: string
}

const hits = new Map<string, Hit>()
let samples = 0
let activeSamples = 0

/** 归一化:去掉参数值,让同一形状的查询归成一条。 */
function shape(q: string): string {
  return q
    .replace(/\s+/g, ' ')
    .replace(/'[^']*'/g, "'?'")
    .replace(/\b\d+\b/g, 'N')
    .trim()
    .slice(0, 220)
}

async function sample() {
  samples++
  try {
    const { rows } = await pool.query<{
      query: string; app: string; dur: string; state: string
    }>(
      `SELECT query,
              COALESCE(application_name, '?')                        AS app,
              EXTRACT(EPOCH FROM (now() - query_start))::text        AS dur,
              state
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'active'
          AND pid <> pg_backend_pid()
          AND query NOT LIKE '%pg_stat_activity%'`
    )
    if (rows.length) activeSamples++
    for (const r of rows) {
      const key = shape(r.query)
      if (!key || key === "'?'") continue
      const cur = hits.get(key) || {
        query: key, seen: 0, maxDurationS: 0, app: r.app, lastSeen: '',
      }
      cur.seen++
      cur.maxDurationS = Math.max(cur.maxDurationS, Math.round(Number(r.dur) || 0))
      cur.lastSeen = new Date().toISOString().slice(11, 19)
      hits.set(key, cur)
    }
  } catch (e) {
    // 采样失败不该把脚本弄死
  }
}

function report() {
  const list = [...hits.values()].sort((a, b) => b.seen - a.seen)
  console.log(`\n${'─'.repeat(74)}`)
  console.log(`采样 ${samples} 次(1/秒) · 其中 ${activeSamples} 次抓到有查询在跑` +
    ` (${samples ? Math.round((activeSamples / samples) * 100) : 0}% 的时间 DB 是忙的)\n`)
  if (!list.length) {
    console.log('  (整个采样期内 DB 一直空闲 —— CPU 尖峰不是 SQL 造成的,')
    console.log('   那就该怀疑 PG 的后台进程:autovacuum / checkpoint / 或者这台机器上跑的别的东西)\n')
    return
  }
  console.log('  按「被抓到的次数」排行(≈ 累计占用了多少秒):\n')
  for (const h of list.slice(0, 10)) {
    console.log(`  ${String(h.seen).padStart(4)}次  最长${String(h.maxDurationS).padStart(3)}s  [${h.app}]`)
    console.log(`        ${h.query}\n`)
  }
}

console.log(`\n开始采样 pg_stat_activity(1 秒 1 次)${RUN_SECONDS ? `,${RUN_SECONDS} 秒后停` : ',Ctrl-C 停'}…\n`)

const timer = setInterval(sample, 1000)

const stop = async () => {
  clearInterval(timer)
  report()
  await pool.end()
  process.exit(0)
}

process.on('SIGINT', stop)
if (RUN_SECONDS > 0) setTimeout(stop, RUN_SECONDS * 1000)
