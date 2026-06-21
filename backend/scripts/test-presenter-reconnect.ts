/**
 * 模拟「经纪带看 + 断线重连」打生产(api.pinzos.com)。
 *
 * 经纪建房 → 客户进房 → 经纪推镜头(客户跟随)→ 经纪**突然掉线**(terminate)
 * → 经纪立刻重连 → 验证它重新认领镜头源 → 再推镜头,客户仍能跟随。
 *
 * 运行:cd backend && npx ts-node scripts/test-presenter-reconnect.ts
 */
import { WebSocket } from 'ws'

const BE = process.env.BE || 'https://api.pinzos.com'
const WS_URL = BE.replace(/^http/, 'ws') + '/api/collab'

let passed = 0
function ok(cond: boolean, label: string): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`) }
  else { console.error(`  ✗ ${label}`); process.exit(1) }
}

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function waitFor(ws: WebSocket, pred: (m: any) => boolean, label: string, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMsg); reject(new Error(`timeout: ${label}`)) }, timeoutMs)
    function onMsg(data: Buffer) {
      let m: any; try { m = JSON.parse(data.toString()) } catch { return }
      // keep heartbeats alive during the wait
      if (m.k === 'ping') { try { ws.send(JSON.stringify({ k: 'pong' })) } catch {} ; return }
      if (pred(m)) { clearTimeout(timer); ws.off('message', onMsg); resolve(m) }
    }
    ws.on('message', onMsg)
  })
}

async function main() {
  console.log(`\n[test-presenter-reconnect] ${WS_URL}\n`)

  // 1. 经纪建房
  const created = await (await fetch(`${BE}/api/collab/rooms`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ahmed' }),
  })).json() as any
  const code: string = created.code
  ok(typeof code === 'string', `room created (${code})`)

  // 2. 经纪进房(presenter)
  let presenter = await connect()
  presenter.send(JSON.stringify({ k: 'hello', code, name: 'Ahmed', role: 'presenter' }))
  const pSync1 = await waitFor(presenter, m => m.k === 'sync', 'presenter sync #1')
  const pConn1 = pSync1.connId
  ok(pSync1.state.presenterConnId === pConn1, 'presenter owns camera (claim #1)')

  // 3. 客户进房(viewer)
  const viewer = await connect()
  viewer.send(JSON.stringify({ k: 'hello', code, name: '李先生', role: 'viewer' }))
  await waitFor(viewer, m => m.k === 'sync', 'viewer sync')

  // 4. 经纪推镜头 → 客户跟随(基线)
  const v1 = waitFor(viewer, m => m.k === 'cam' && m.z === 13.2, 'viewer follows presenter (before drop)')
  presenter.send(JSON.stringify({ k: 'cam', t: Date.now(), c: [55.14, 25.08], z: 13.2, b: 0, p: 0 }))
  await v1
  ok(true, '客户跟随经纪镜头(掉线前)')

  // 5. 经纪「突然掉线」—— terminate 不发 close 帧,模拟网络掉线
  console.log('  … 经纪突然掉线(terminate)')
  presenter.terminate()

  // 6. 经纪立刻重连(压力测试:旧死 socket 可能还没被服务器清理)
  presenter = await connect()
  presenter.send(JSON.stringify({ k: 'hello', code, name: 'Ahmed', role: 'presenter', resumeSeq: pSync1.state.seq }))
  const pSync2 = await waitFor(presenter, m => m.k === 'sync', 'presenter sync #2 (reconnect)')
  const pConn2 = pSync2.connId
  ok(pConn2 !== pConn1, `reconnect got a new connId`)
  ok(pSync2.state.presenterConnId === pConn2, '经纪重连后重新认领镜头源 ✅')

  // 7. 重连后再推镜头 → 客户仍能跟随(端到端证明重连可用)
  const v2 = waitFor(viewer, m => m.k === 'cam' && m.z === 15.5, 'viewer follows reconnected presenter')
  presenter.send(JSON.stringify({ k: 'cam', t: Date.now(), c: [55.27, 25.20], z: 15.5, b: 0, p: 0 }))
  await v2
  ok(true, '客户跟随经纪镜头(重连后)✅')

  // 8. 重连后可靠事件也通(chat)
  const vChat = waitFor(viewer, m => m.k === 'chat' && m.text === 'reconnected', 'viewer gets chat after reconnect')
  presenter.send(JSON.stringify({ k: 'chat', from: 'agent', name: 'Ahmed', text: 'reconnected' }))
  await vChat
  ok(true, '重连后聊天/可靠事件正常')

  presenter.close(); viewer.close()
  console.log(`\nALL PRESENTER-RECONNECT TESTS PASSED (${passed} assertions)\n`)
  process.exit(0)
}

main().catch((e) => { console.error('\n[test-presenter-reconnect] FAILED:', e?.message || e); process.exit(1) })
