/**
 * 把**已经生成好**的剧本里的 bearing 全部锁成同一个值（通常是 0 = 正北）。
 *
 * 为什么需要回填:`clampCinematography` 原来只锁**一拍之内**的 bearing —— 每拍各自锁到
 * 自己的第一帧,拍与拍之间仍然不同,引擎在拍之间平滑插值 → **整场 tour 慢慢转 80°**。
 * 新生成的剧本已经由 lockBearingAcrossScript 修好,但**库里已有的 tour 还在转**。
 *
 * 只改 bearing,不动 center/zoom/pitch/旁白/音频 —— 所以**不需要重烧语音**。
 *
 *   npx ts-node -T scripts/lock-tour-bearings.ts            # 预演(不写库)
 *   npx ts-node -T scripts/lock-tour-bearings.ts --apply    # 真的写
 */
import 'dotenv/config'
import pool from '../src/db/pool'

const APPLY = process.argv.includes('--apply')

interface Cam { bearing?: number }
interface Beat { camera?: Cam[] }
interface Script { intro?: Beat; outro?: Beat; acts?: { beats?: Beat[] }[] }

function beatsOf(s: Script): Beat[] {
  return [s.intro, ...(s.acts || []).flatMap((a) => a.beats || []), s.outro].filter(Boolean) as Beat[]
}

async function main() {
  const { rows } = await pool.query<{ id: string; code: string; script: Script }>(
    `SELECT t.id::text, s.share_code AS code, t.script
       FROM lt_tour_scripts t JOIN lt_demo_sessions s ON s.id = t.session_id`
  )
  console.log(`${rows.length} 份剧本\n`)

  let changed = 0
  for (const r of rows) {
    const beats = beatsOf(r.script)
    const bearings = beats.flatMap((b) => (b.camera || []).map((c) => c.bearing)).filter((b): b is number => typeof b === 'number')
    if (!bearings.length) continue

    const target = bearings[0]
    const spread = Math.max(...bearings) - Math.min(...bearings)
    if (spread === 0) continue

    for (const b of beats) for (const c of b.camera || []) if (typeof c.bearing === 'number') c.bearing = target

    console.log(`  ${r.code.padEnd(10)} bearing 跨度 ${spread}° → 全锁成 ${target}°`)
    changed++
    if (APPLY) {
      await pool.query(`UPDATE lt_tour_scripts SET script = $2 WHERE id = $1`, [r.id, JSON.stringify(r.script)])
    }
  }

  console.log(`\n${changed} 份需要修${APPLY ? '（已写库）' : '（预演 —— 加 --apply 才真的写）'}`)
  await pool.end()
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1) })
