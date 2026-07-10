/**
 * Collab WS 集成测试 —— 自包含,不连 DB / Gemini。
 *
 * 起一个最小 express app + initCollabWebSocket,listen(0) 取随机端口,
 * 用 ws 客户端 + fetch 跑断言。每条打印 ✓/✗;任一失败 exit(1),全过 exit(0)。
 *
 * 运行:cd backend && npm run test:collab
 */

import http from 'http'
import express from 'express'
import { WebSocket } from 'ws'
import { AddressInfo } from 'net'
import collabRouter, { initCollabWebSocket } from '../src/routes/collab'

let passed = 0
function ok(cond: boolean, label: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    console.error(`  ✗ ${label}`)
    process.exit(1)
  }
}

// 等待一个满足 predicate 的消息(带超时)
function waitFor(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  label: string,
  timeoutMs = 3000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg)
      reject(new Error(`timeout waiting for: ${label}`))
    }, timeoutMs)
    function onMsg(data: Buffer) {
      let msg: any
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (predicate(msg)) {
        clearTimeout(timer)
        ws.off('message', onMsg)
        resolve(msg)
      }
    }
    ws.on('message', onMsg)
  })
}

// 短暂断言"不会收到"某消息(用于验证 cam 被忽略)
function expectNone(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  windowMs = 400
): Promise<boolean> {
  return new Promise((resolve) => {
    let seen = false
    function onMsg(data: Buffer) {
      let msg: any
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (predicate(msg)) seen = true
    }
    ws.on('message', onMsg)
    setTimeout(() => {
      ws.off('message', onMsg)
      resolve(!seen)
    }, windowMs)
  })
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

async function run(): Promise<void> {
  // ── 起最小 server ───────────────────────────────
  const app = express()
  app.use(express.json())
  app.use('/api/collab', collabRouter)
  const server = http.createServer(app)
  initCollabWebSocket(server)

  await new Promise<void>((resolve) => server.listen(0, resolve))
  const port = (server.address() as AddressInfo).port
  const base = `http://127.0.0.1:${port}`
  const wsUrl = `ws://127.0.0.1:${port}/api/collab`

  console.log(`\n[test-collab] server on :${port}\n`)

  // ── 1. REST 建房 + 校验 ──────────────────────────
  console.log('1. REST create + verify room')
  const createRes = await fetch(`${base}/api/collab/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ahmed' })
  })
  const created = await createRes.json() as { code: string; url: string }
  ok(typeof created.code === 'string' && created.code.length >= 4, `create returns code (${created.code})`)
  ok(created.url.includes(created.code), 'create returns share url')

  const code = created.code
  const verifyRes = await fetch(`${base}/api/collab/rooms/${code}`)
  const verify = await verifyRes.json() as { exists: boolean; participants: number }
  ok(verify.exists === true, 'GET /rooms/:code exists=true')

  const missing = await (await fetch(`${base}/api/collab/rooms/ZZZZZ`)).json() as { exists: boolean }
  ok(missing.exists === false, 'GET unknown code exists=false')

  // ── 2. presenter hello → sync,presenterConnId == 自己 ──
  console.log('2. presenter hello -> sync')
  const presenter = await connect(wsUrl)
  presenter.send(JSON.stringify({ k: 'hello', code, name: 'Ahmed', role: 'presenter' }))
  const pSync = await waitFor(presenter, m => m.k === 'sync', 'presenter sync')
  const presenterConnId = pSync.connId
  ok(typeof presenterConnId === 'string', 'presenter got connId')
  ok(pSync.state.presenterConnId === presenterConnId, 'state.presenterConnId == self')

  // ── 3. viewer hello → sync;presenter 收到 join(who=viewer) ──
  console.log('3. viewer hello -> sync + presenter sees join')
  const viewer = await connect(wsUrl)
  const presenterJoin = waitFor(presenter, m => m.k === 'join' && m.who?.role === 'viewer', 'presenter sees viewer join')
  viewer.send(JSON.stringify({ k: 'hello', code, name: '李先生', role: 'viewer' }))
  const vSync = await waitFor(viewer, m => m.k === 'sync', 'viewer sync')
  const viewerConnId = vSync.connId
  ok(typeof viewerConnId === 'string' && viewerConnId !== presenterConnId, 'viewer got distinct connId')
  ok(vSync.state.presenterConnId === presenterConnId, 'viewer sync shows presenter')
  const joinEvt = await presenterJoin
  ok(joinEvt.who.connId === viewerConnId, 'join event who == viewer connId')

  // ── 4. cam:presenter→viewer 到达;viewer→presenter 被忽略 ──
  console.log('4. cam fanout (presenter only)')
  const viewerCam = waitFor(viewer, m => m.k === 'cam' && m.z === 13.2, 'viewer receives presenter cam')
  presenter.send(JSON.stringify({ k: 'cam', t: Date.now(), c: [55.14, 25.08], z: 13.2, b: 0, p: 45 }))
  const gotCam = await viewerCam
  ok(gotCam.c[0] === 55.14, 'viewer got presenter cam payload')

  const presenterGotNoCam = expectNone(presenter, m => m.k === 'cam')
  viewer.send(JSON.stringify({ k: 'cam', t: Date.now(), c: [1, 2], z: 9, b: 0, p: 0 }))
  ok(await presenterGotNoCam, 'non-presenter cam is ignored')

  // ── 5. chat/select/goto → viewer 收到,seq 严格递增且连续 ──
  console.log('5. reliable events with strictly increasing contiguous seq')
  const seqs: number[] = []
  const collectThree = new Promise<void>((resolve) => {
    let n = 0
    function onMsg(data: Buffer) {
      const m = JSON.parse(data.toString())
      if (m.k === 'chat' || m.k === 'select' || m.k === 'goto') {
        seqs.push(m.seq)
        if (++n === 3) {
          viewer.off('message', onMsg)
          resolve()
        }
      }
    }
    viewer.on('message', onMsg)
  })
  presenter.send(JSON.stringify({ k: 'chat', from: 'agent', name: 'Ahmed', text: '回报率不错' }))
  presenter.send(JSON.stringify({ k: 'select', kind: 'project', id: 'uuid-1' }))
  presenter.send(JSON.stringify({ k: 'goto', c: [55.27, 25.20], z: 14, b: 0, p: 0, label: 'Marina' }))
  await collectThree
  ok(seqs.length === 3, 'viewer received chat+select+goto')
  ok(seqs[1] === seqs[0] + 1 && seqs[2] === seqs[1] + 1, `seq contiguous & increasing (${seqs.join(',')})`)
  const lastSeqBeforeReconnect = seqs[2]

  // ── 6. viewer 重连 hello{resumeSeq} → sync + 补发 seq>resumeSeq ──
  console.log('6. reconnect with resumeSeq backfill')
  // resume 从 chat 之前(seqs[0]-1)开始,应补回 chat/select/goto 三条(其 seq == seqs)
  const resumeFrom = seqs[0] - 1
  viewer.close()
  await waitFor(presenter, m => m.k === 'leave', 'presenter sees viewer leave (pre-reconnect)')

  const viewer2 = await connect(wsUrl)
  const backfilled: number[] = []
  let sawSync = false
  const reconnectDone = new Promise<void>((resolve) => {
    function onMsg(data: Buffer) {
      const m = JSON.parse(data.toString())
      if (m.k === 'sync') sawSync = true
      if ((m.k === 'chat' || m.k === 'select' || m.k === 'goto') && typeof m.seq === 'number') {
        backfilled.push(m.seq)
      }
    }
    viewer2.on('message', onMsg)
    setTimeout(() => { viewer2.off('message', onMsg); resolve() }, 600)
  })
  viewer2.send(JSON.stringify({ k: 'hello', code, name: '李先生', role: 'viewer', resumeSeq: resumeFrom }))
  await reconnectDone
  ok(sawSync, 'reconnect got sync')
  const expectedBackfill = seqs.filter(s => s > resumeFrom)
  ok(
    backfilled.length === expectedBackfill.length &&
    backfilled.every((s, i) => s === expectedBackfill[i]),
    `backfill exact, no gaps/dupes (got ${backfilled.join(',')} expected ${expectedBackfill.join(',')})`
  )
  ok(backfilled.every(s => s > resumeFrom), 'no seq <= resumeSeq backfilled')
  ok(backfilled.includes(lastSeqBeforeReconnect), 'latest reliable event included')

  // ── 7. ping → pong ──────────────────────────────
  console.log('7. ping -> pong')
  const pong = waitFor(viewer2, m => m.k === 'pong', 'pong', 2000)
  viewer2.send(JSON.stringify({ k: 'ping' }))
  await pong
  ok(true, 'ping answered with pong')

  // ── 8. viewer 关闭 → presenter 收到 leave ──────────
  console.log('8. viewer close -> presenter sees leave')
  const presenterLeave = waitFor(presenter, m => m.k === 'leave', 'presenter sees leave')
  viewer2.close()
  await presenterLeave
  ok(true, 'leave fanned out to presenter')

  // ── 8.5 客户身份门(S2):identify → 进事件日志 + 广播给房间 ──
  console.log('8.5. identify reaches the room')
  const namedViewer = await connect(wsUrl)
  namedViewer.send(JSON.stringify({ k: 'hello', code, name: '陈先生', role: 'viewer' }))
  await waitFor(namedViewer, m => m.k === 'sync', 'named viewer sync')
  const presenterIdentify = waitFor(presenter, m => m.k === 'identify' && m.name === '陈先生', 'presenter sees identify', 2000)
  const idRes = await fetch(`${base}/api/collab/rooms/${code}/identify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '陈先生', phone: '+971 50 111 2222', whatsapp: 'chen-wx' }),
  })
  ok(idRes.ok, 'POST identify returns 200')
  const idEvt = await presenterIdentify
  ok(idEvt.phone === '+971 50 111 2222', 'identify carries phone into the room event')
  namedViewer.close()
  await waitFor(presenter, m => m.k === 'leave', 'presenter sees named viewer leave')

  // ── 9. 防偷听:presenter 踢人 + 结束带看即失效(旧 code 进不去)──
  console.log('9. anti-eavesdrop: kick + end invalidates the code')
  // 一个 viewer 加入(在场),presenter 踢掉它
  const viewer3 = await connect(wsUrl)
  const v3JoinSeen = waitFor(presenter, m => m.k === 'join' && m.who?.role === 'viewer', 'presenter sees viewer3 join')
  viewer3.send(JSON.stringify({ k: 'hello', code, name: '偷听者', role: 'viewer' }))
  const v3Sync = await waitFor(viewer3, m => m.k === 'sync', 'viewer3 sync')
  const viewer3ConnId = v3Sync.connId
  await v3JoinSeen
  const v3Kicked = waitFor(viewer3, m => m.k === 'kicked', 'viewer3 receives kicked', 2000)
  const v3Closed = new Promise<void>((resolve) => viewer3.once('close', () => resolve()))
  presenter.send(JSON.stringify({ k: 'kick', connId: viewer3ConnId }))
  await v3Kicked
  ok(true, 'kicked viewer received {k:kicked}')
  await v3Closed
  ok(true, 'kicked viewer connection closed')

  // presenter 结束带看 → 房间删,code 立即失效
  presenter.send(JSON.stringify({ k: 'end' }))
  await new Promise((r) => setTimeout(r, 250)) // 给 server 处理 end + 删房
  const afterEnd = await (await fetch(`${base}/api/collab/rooms/${code}`)).json() as { exists: boolean }
  ok(afterEnd.exists === false, 'after end: GET /rooms/:code exists=false (code invalidated)')

  // 上一位客户拿旧 code 再进 → room_not_found(偷听被挡)
  const eavesdropper = await connect(wsUrl)
  const denied = waitFor(eavesdropper, m => m.k === 'error' && m.reason === 'room_not_found', 'eavesdropper denied', 2000)
  eavesdropper.send(JSON.stringify({ k: 'hello', code, name: '偷听者2', role: 'viewer' }))
  await denied
  ok(true, 'old link → room_not_found (eavesdrop blocked)')
  eavesdropper.close()

  // ── 收尾 ────────────────────────────────────────
  presenter.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))

  console.log(`\nALL COLLAB TESTS PASSED (${passed} assertions)\n`)
  process.exit(0)
}

run().catch((err) => {
  console.error('\n[test-collab] FAILED:', err)
  process.exit(1)
})
