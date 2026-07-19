/**
 * 把 /api/market/area-monthly 的真实结果 dump 成 JSON —— 给前端时间轴做
 * 「未部署也能用真数据验收」用（playwright 拦截该请求喂这份文件）。
 *
 *   cd backend && npx ts-node -T scripts/dump-area-monthly.ts <out.json>
 *
 * 只读，不写库。
 */
import fs from 'fs'
import { loadAreaMonthly } from '../src/routes/market'
import pool from '../src/db/pool'

async function main() {
  const out = process.argv[2] || 'area-monthly.json'
  const t0 = Date.now()
  const data = await loadAreaMonthly()
  const ms = Date.now() - t0
  fs.writeFileSync(out, JSON.stringify(data))
  const bytes = fs.statSync(out).size
  const areas = Object.keys(data.areas).length

  // 覆盖度体检:每个月有多少区能出租金 / 成交中位数(3 个月滚动窗口,门槛已在 loader 里生效)
  const cov = (key: 'rent' | 'price' | 'growth', i: number) =>
    Object.values(data.areas).filter((a: any) => a[key][i] != null).length
  const step = Math.max(1, Math.floor(data.months.length / 12))
  for (let i = 0; i < data.months.length; i += step) {
    console.log(`  ${data.months[i]}  租金 ${String(cov('rent', i)).padStart(3)} 区 · 成交 ${String(cov('price', i)).padStart(3)} 区 · 同比 ${String(cov('growth', i)).padStart(3)} 区`)
  }
  await pool.end()
  // ⚠️ 必须显式退出:import market.ts 会注册区域预热器的 setTimeout(30s)+
  // setInterval(5h),事件循环不会自己空掉 —— 挂着的话 30 秒后会拿**已关闭的连接池**
  // 去打生产库,而且 interval 让进程永远不退。就是 memory 里那条「本地残留进程
  // 连生产库作乱」。
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
