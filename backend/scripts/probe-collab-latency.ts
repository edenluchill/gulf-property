/**
 * 生产 collab WS 端到端延迟探针 —— 回答「实时带看为什么有延迟」。
 *
 * 起两条真实 WS 到生产(presenter + viewer,同一房间),测三件事:
 *   1. WS 握手耗时(TLS + upgrade,含 Cloudflare 一跳)
 *   2. 应用层 ping→pong 往返(纯网络 RTT)
 *   3. cam 帧 presenter→server→viewer 的端到端延迟(实时带看的真身)
 *   4. 高频压力:20Hz 连发 3 秒,看延迟是否累积(队列堆积 = 越来越慢)
 *
 * 两条连接都在本机 → 同一时钟,delta 直接可信。
 *
 * 用法:npx ts-node -T scripts/probe-collab-latency.ts [wss://api.pinzos.com/api/collab]
 */
import { WebSocket } from 'ws'

const URL = process.argv[2] || 'wss://api.pinzos.com/api/collab'
// 4–8 位、A-Z0-9(normalizeCode 的约束)
const CODE = 'PB' + Math.floor(Math.random() * 900 + 100)

const stats = (xs: number[]) => {
  if (!xs.length) return 'n/a'
  const s = [...xs].sort((a, b) => a - b)
  const p = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))]
  return `min ${s[0]}ms · p50 ${p(0.5)}ms · p95 ${p(0.95)}ms · max ${s[s.length - 1]}ms  (n=${s.length})`
}

function open(role: 'presenter' | 'viewer'): Promise<{ ws: WebSocket; handshakeMs: number }> {
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL)
    const timer = setTimeout(() => reject(new Error(`${role}: 握手超时 >15s`)), 15000)
    ws.on('open', () => {
      clearTimeout(timer)
      const handshakeMs = Date.now() - t0
      ws.send(JSON.stringify({ k: 'hello', code: CODE, name: `probe-${role}`, role }))
      resolve({ ws, handshakeMs })
    })
    ws.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

async function run() {
  console.log(`🔌 ${URL}  room=${CODE}\n`)

  const p = await open('presenter')
  await new Promise((r) => setTimeout(r, 300))   // 让房间建起来
  const v = await open('viewer')
  console.log(`握手(TLS+upgrade):presenter ${p.handshakeMs}ms · viewer ${v.handshakeMs}ms`)

  // viewer 必须收到 sync,否则房间没建起来
  const synced = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5000)
    v.ws.on('message', function onMsg(d: Buffer) {
      const m = JSON.parse(d.toString())
      if (m.k === 'sync') { clearTimeout(t); v.ws.off('message', onMsg); resolve(true) }
      if (m.k === 'error') { clearTimeout(t); console.error('❌ server error:', m.reason); resolve(false) }
    })
  })
  if (!synced) { console.error('❌ viewer 没进到房间,后面的测量没意义'); process.exit(1) }
  console.log('✅ viewer 已进房\n')

  // ── ① ping/pong 纯 RTT ──────────────────────────────────
  const rtts: number[] = []
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now()
    const rtt = await new Promise<number>((resolve) => {
      p.ws.on('message', function onMsg(d: Buffer) {
        if (JSON.parse(d.toString()).k === 'pong') { p.ws.off('message', onMsg); resolve(Date.now() - t0) }
      })
      p.ws.send(JSON.stringify({ k: 'ping' }))
    })
    rtts.push(rtt)
    await new Promise((r) => setTimeout(r, 100))
  }
  console.log(`① ping→pong 往返(本机↔生产): ${stats(rtts)}`)

  // ── ② cam 端到端:presenter → server → viewer ────────────
  const e2e: number[] = []
  v.ws.on('message', (d: Buffer) => {
    const m = JSON.parse(d.toString())
    if (m.k === 'cam' && typeof m.t === 'number') e2e.push(Date.now() - m.t)
  })
  for (let i = 0; i < 20; i++) {
    p.ws.send(JSON.stringify({ k: 'cam', t: Date.now(), c: [55.27, 25.2], z: 14, b: 0, p: 0 }))
    await new Promise((r) => setTimeout(r, 150))
  }
  await new Promise((r) => setTimeout(r, 800))
  console.log(`② cam 端到端(经纪→服务器→客户): ${stats(e2e)}`)

  // ── ③ 20Hz 压力:延迟会不会累积 ──────────────────────────
  const burst: number[] = []
  const before = e2e.length
  v.ws.removeAllListeners('message')
  v.ws.on('message', (d: Buffer) => {
    const m = JSON.parse(d.toString())
    if (m.k === 'cam' && typeof m.t === 'number') burst.push(Date.now() - m.t)
  })
  const t0 = Date.now()
  while (Date.now() - t0 < 3000) {
    p.ws.send(JSON.stringify({ k: 'cam', t: Date.now(), c: [55.27, 25.2], z: 14, b: 0, p: 0, vw: 1180, vh: 800 }))
    await new Promise((r) => setTimeout(r, 50))   // 20Hz,和真实经纪端一致
  }
  await new Promise((r) => setTimeout(r, 1500))
  console.log(`③ 20Hz 连发 3s(${burst.length} 帧): ${stats(burst)}`)
  if (burst.length > 10) {
    const head = burst.slice(0, 10).reduce((a, b) => a + b, 0) / 10
    const tail = burst.slice(-10).reduce((a, b) => a + b, 0) / 10
    const drift = Math.round(tail - head)
    console.log(`   前10帧均值 ${Math.round(head)}ms → 后10帧均值 ${Math.round(tail)}ms  ${
      drift > 200 ? `⚠️ 延迟在累积(+${drift}ms)= 服务端/网络吞不下 20Hz` : `✅ 无累积(${drift >= 0 ? '+' : ''}${drift}ms)`
    }`)
  }
  console.log(`   丢帧: 发出 ${Math.round(3000 / 50)} 帧上下,收到 ${burst.length} 帧 ${before >= 0 ? '' : ''}`)

  p.ws.close(); v.ws.close()
  console.log('\n判读:实时带看是 WS 直传,理论延迟 ≈ 一个 RTT。若 ①② 都是几十~几百 ms,')
  console.log('     那客户端看到的「半分钟」就不在这条链路上(而在音视频 / 首次进房 / 地图瓦片)。')
  process.exit(0)
}

run().catch((e) => { console.error('❌', e.message); process.exit(1) })
