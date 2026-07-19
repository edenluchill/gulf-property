/**
 * 把 /api/market/area-yearly 的真实结果 dump 成 JSON —— 给前端时间轴做
 * 「未部署也能用真数据验收」用（playwright 拦截该请求喂这份文件）。
 *
 *   cd backend && npx ts-node -T scripts/dump-area-yearly.ts <out.json>
 *
 * 只读，不写库。
 */
import fs from 'fs'
import { loadAreaYearly } from '../src/routes/market'
import pool from '../src/db/pool'

async function main() {
  const out = process.argv[2] || 'area-yearly.json'
  const t0 = Date.now()
  const data = await loadAreaYearly()
  const ms = Date.now() - t0
  fs.writeFileSync(out, JSON.stringify(data))
  const bytes = fs.statSync(out).size
  const areas = Object.keys(data.areas).length

  // 覆盖度体检：每年多少区能出租金 / 成交中位数（样本门槛已在 loader 里生效）
  console.log(`查询耗时 ${ms}ms · ${areas} 区 · ${(bytes / 1024).toFixed(0)}KB · years=${data.years.join(',')} · ytd=${data.ytdYear}`)
  for (const y of data.years) {
    let rent = 0, price = 0, growth = 0
    for (const byYear of Object.values(data.areas)) {
      const c = byYear[String(y)]
      if (!c) continue
      if (c.rent != null) rent++
      if (c.price != null) price++
      if (c.growth != null) growth++
    }
    console.log(`  ${y}  租金中位数 ${String(rent).padStart(3)} 区 · 成交中位数 ${String(price).padStart(3)} 区 · 同比 ${String(growth).padStart(3)} 区`)
  }
  await pool.end()
  // ⚠️ 必须显式退出:import market.ts 会注册区域预热器的 setTimeout(30s)+
  // setInterval(5h),事件循环不会自己空掉 —— 挂着的话 30 秒后会拿**已关闭的连接池**
  // 去打生产库,而且 interval 让进程永远不退。就是 memory 里那条「本地残留进程
  // 连生产库作乱」。
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
