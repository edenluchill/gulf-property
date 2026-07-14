/**
 * 实时带看容量压测 —— 「1000 人同时用会不会炸」的实证答案。
 *
 * 起一个**本地** collab server(和生产同一份代码 initCollabWebSocket),再用另一个
 * 进程压它。测的是**服务端单核的处理能力**,不是网络 —— loopback 上 RTT≈0,
 * 所以量到的延迟就是服务端排队 + 处理的时延。
 *
 * 为什么单核:后端是**单进程单线程**(没有 cluster/worker_threads),cpx11 那 2 个
 * vCPU 里只有 1 个在跑所有 API + WS。所以容量 = 单核能吃下多少 msg/s。
 *
 * 负载模型:N 个房间,每房 1 经纪 + V 个客户。经纪 20Hz 发 cam(和真实前端一致),
 * 服务端 fanout 给每个客户。
 *   入站 = N × 20 msg/s     出站 = N × 20 × V msg/s
 *
 * 用法(两个终端 / 或 server 用 run_in_background):
 *   npx ts-node -T scripts/loadtest-collab.ts server
 *   npx ts-node -T scripts/loadtest-collab.ts load <rooms> <viewersPerRoom> [seconds]
 *
 * 例:250 房 × 3 客户 = 1000 条连接
 *   npx ts-node -T scripts/loadtest-collab.ts load 250 3 20
 */
import http from 'http'
import express from 'express'
import { WebSocket } from 'ws'
import collabRouter, { initCollabWebSocket } from '../src/routes/collab'

const PORT = 4599
const MODE = process.argv[2]

// ── server ────────────────────────────────────────────────────────────
if (MODE === 'server') {
  const app = express()
  app.use('/api/collab', collabRouter)
  const server = http.createServer(app)
  initCollabWebSocket(server)

  let lastCpu = process.cpuUsage()
  let lastAt = Date.now()
  setInterval(() => {
    const cpu = process.cpuUsage(lastCpu)
    const dt = Date.now() - lastAt
    lastCpu = process.cpuUsage()
    lastAt = Date.now()
    // 单核占用率:进程消耗的 CPU 微秒 / 墙钟微秒。100% = 一个核吃满(= 到顶了)
    const pct = Math.round(((cpu.user + cpu.system) / 1000 / dt) * 100)
    const mem = Math.round(process.memoryUsage().rss / 1e6)
    console.log(`[server] CPU ${String(pct).padStart(3)}% (单核满载=100%) · RSS ${mem} MB`)
  }, 2000)

  server.listen(PORT, () => console.log(`[server] collab 压测服务器 :${PORT}\n`))
}

// ── load generator ────────────────────────────────────────────────────
if (MODE === 'load') {
  const ROOMS = Number(process.argv[3] || 50)
  const VIEWERS = Number(process.argv[4] || 3)
  const SECONDS = Number(process.argv[5] || 20)
  const HZ = 20

  const URL = `ws://127.0.0.1:${PORT}/api/collab`
  const conns: WebSocket[] = []
  const lat: number[] = []
  let received = 0
  let sent = 0

  const code = (i: number) => `LT${String(i).padStart(4, '0')}`   // 4–8 位

  function connect(role: 'presenter' | 'viewer', room: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(URL)
      const t = setTimeout(() => reject(new Error('connect timeout')), 20000)
      ws.on('open', () => {
        clearTimeout(t)
        ws.send(JSON.stringify({ k: 'hello', code: code(room), name: role, role }))
        conns.push(ws)
        resolve(ws)
      })
      ws.on('error', (e) => { clearTimeout(t); reject(e) })
    })
  }

  async function run() {
    console.log(`建连:${ROOMS} 房 × (1 经纪 + ${VIEWERS} 客户) = ${ROOMS * (1 + VIEWERS)} 条 WS`)
    console.log(`负载:入站 ${ROOMS * HZ} msg/s · 出站 ${ROOMS * HZ * VIEWERS} msg/s\n`)

    const presenters: WebSocket[] = []
    for (let r = 0; r < ROOMS; r++) {
      presenters.push(await connect('presenter', r))
      for (let v = 0; v < VIEWERS; v++) {
        const ws = await connect('viewer', r)
        ws.on('message', (d: Buffer) => {
          let m: any
          try { m = JSON.parse(d.toString()) } catch { return }
          if (m.k === 'cam' && typeof m.t === 'number') {
            received++
            lat.push(Date.now() - m.t)   // loopback → 这就是服务端处理时延
          }
        })
      }
      if (r % 50 === 49) console.log(`  … ${r + 1}/${ROOMS} 房已连上`)
    }
    console.log(`\n✅ ${conns.length} 条连接就绪,开始 ${SECONDS}s 压测(经纪端 ${HZ}Hz)\n`)

    const timers = presenters.map((ws) =>
      setInterval(() => {
        try {
          ws.send(JSON.stringify({ k: 'cam', t: Date.now(), c: [55.27, 25.2], z: 14, b: 0, p: 0, vw: 1180, vh: 800 }))
          sent++
        } catch { /* ignore */ }
      }, 1000 / HZ)
    )

    const t0 = Date.now()
    const report = setInterval(() => {
      const s = [...lat].sort((a, b) => a - b)
      const p = (q: number) => (s.length ? s[Math.floor(s.length * q)] : 0)
      const secs = (Date.now() - t0) / 1000
      console.log(
        `[load] ${secs.toFixed(0)}s · 出站 ${Math.round(received / secs)} msg/s · ` +
        `服务端处理延迟 p50 ${p(0.5)}ms · p95 ${p(0.95)}ms · max ${s[s.length - 1] ?? 0}ms`
      )
      lat.length = 0
    }, 2000)

    setTimeout(() => {
      clearInterval(report)
      timers.forEach(clearInterval)
      const expected = sent * VIEWERS
      const loss = expected > 0 ? Math.max(0, Math.round((1 - received / expected) * 100)) : 0
      console.log(`\n发出 ${sent} 帧 → 应收 ${expected} → 实收 ${received}(丢 ${loss}%)`)
      console.log(loss > 5
        ? '❌ 丢帧严重 —— 这个并发已经超出单核能力'
        : '✅ 无明显丢帧')
      conns.forEach((w) => w.close())
      process.exit(0)
    }, SECONDS * 1000)
  }

  run().catch((e) => { console.error('❌', e.message); process.exit(1) })
}

if (MODE !== 'server' && MODE !== 'load') {
  console.log('用法: loadtest-collab.ts server | load <rooms> <viewersPerRoom> [seconds]')
  process.exit(1)
}
