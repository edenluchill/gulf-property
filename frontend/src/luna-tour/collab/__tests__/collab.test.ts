/**
 * Luna Collaborative Tour — core logic unit tests (node:test).
 *
 * No vitest in this repo, so these run with the bundled `tsx` + node's built-in
 * test runner against the REAL modules:
 *
 *   cd frontend && npx tsx --test src/luna-tour/collab/__tests__/collab.test.ts
 *
 * Covers the pure follow-math and CollabClient reconnect/de-dupe/heartbeat with
 * a fake WebSocket — zero DOM, zero network, zero maplibre.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  lerpAngle,
  angleDelta,
  stepCamera,
  cameraConverged,
  shouldSendCam,
  classifyMove,
  zoomOffsetForViewport,
  type CamState,
} from '../follow-math.ts'
import { collabWsUrl } from '../protocol.ts'
import { CollabClient, type CollabSocket } from '../CollabClient.ts'
import { selectMessage, chatMessage, shouldStoreRemoteTarget } from '../collab-actions.ts'

// ── fake socket ─────────────────────────────────────────────────────────────
class FakeSocket implements CollabSocket {
  sent: string[] = []
  closed = false
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null

  send(data: string) {
    this.sent.push(data)
  }
  close(code?: number, reason?: string) {
    this.closed = true
    this.onclose?.({ code, reason })
  }
  // test helpers
  open() {
    this.onopen?.({})
  }
  recv(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }
  serverDrop(code = 1006) {
    this.onclose?.({ code })
  }
  sentJson(): unknown[] {
    return this.sent.map((s) => JSON.parse(s))
  }
}

// ── follow-math ──────────────────────────────────────────────────────────────
test('lerpAngle takes the short arc across the 0/360 wrap', () => {
  // 359 → 1 should move +2° (toward 360/0), half-way lands on 0, not -179.
  const half = lerpAngle(359, 1, 0.5)
  assert.ok(Math.abs(half - 0) < 1e-9 || Math.abs(half - 360) < 1e-9, `got ${half}`)
  // small step from 359 toward 1 goes UP past 360 → near 0, never down toward 358.
  const small = lerpAngle(359, 1, 0.5)
  assert.ok(angleDelta(359, small) < angleDelta(small, 1) + 1e-9)
  assert.equal(angleDelta(359, 1), 2)
})

test('stepCamera converges to target and cameraConverged flips true', () => {
  const target: CamState = { c: [55.27, 25.2], z: 14, b: 350, p: 45 }
  let cur: CamState = { c: [55.1, 25.05], z: 11, b: 10, p: 0 }
  for (let i = 0; i < 200; i++) cur = stepCamera(cur, target)
  assert.ok(cameraConverged(cur, target), 'should converge after enough steps')
  assert.ok(Math.abs(cur.c[0] - target.c[0]) < 1e-4)
  assert.ok(angleDelta(cur.b, target.b) < 0.05)
  // not yet converged early on
  const early = stepCamera({ c: [55.1, 25.05], z: 11, b: 10, p: 0 }, target)
  assert.equal(cameraConverged(early, target), false)
})

test('shouldSendCam: null prev sends, micro-move suppressed, big move sends', () => {
  const base: CamState = { c: [55.2, 25.1], z: 13, b: 0, p: 0 }
  assert.equal(shouldSendCam(null, base), true)
  const micro: CamState = { c: [55.2 + 1e-7, 25.1], z: 13, b: 0, p: 0.05 }
  assert.equal(shouldSendCam(base, micro), false)
  const moved: CamState = { c: [55.21, 25.1], z: 13, b: 0, p: 0 }
  assert.equal(shouldSendCam(base, moved), true)
  const zoomed: CamState = { c: [55.2, 25.1], z: 13.5, b: 0, p: 0 }
  assert.equal(shouldSendCam(base, zoomed), true)
  const rotated: CamState = { c: [55.2, 25.1], z: 13, b: 1, p: 0 }
  assert.equal(shouldSendCam(base, rotated), true)
})

test('classifyMove: small pan = stream, cross-district / big zoom = jump', () => {
  const a: CamState = { c: [55.2, 25.1], z: 13, b: 0, p: 0 }
  assert.equal(classifyMove(null, a), 'jump')
  // tiny pan at z13 stays in view
  const nudge: CamState = { c: [55.2005, 25.1003], z: 13, b: 0, p: 0 }
  assert.equal(classifyMove(a, nudge), 'stream')
  // jump across Dubai (Marina → Downtown ~0.13° at z13 span ~0.044° → > thresh)
  const farPan: CamState = { c: [55.33, 25.2], z: 13, b: 0, p: 0 }
  assert.equal(classifyMove(a, farPan), 'jump')
  // big zoom change alone
  const bigZoom: CamState = { c: [55.2, 25.1], z: 15, b: 0, p: 0 }
  assert.equal(classifyMove(a, bigZoom), 'jump')
})

test('collabWsUrl maps http→ws, https→wss, appends /api/collab', () => {
  assert.equal(collabWsUrl('http://localhost:3000'), 'ws://localhost:3000/api/collab')
  assert.equal(collabWsUrl('https://api.pinzos.com'), 'wss://api.pinzos.com/api/collab')
  assert.equal(collabWsUrl('https://api.pinzos.com/'), 'wss://api.pinzos.com/api/collab')
})

// ── collab-actions (integration decisions) ───────────────────────────────────
test('selectMessage builds a reliable select with placeholder seq', () => {
  const m = selectMessage('project', 'uuid-1')
  assert.deepEqual(m, { k: 'select', seq: 0, kind: 'project', id: 'uuid-1' })
  const a = selectMessage('area', 'business-bay')
  assert.equal(a.k === 'select' && a.kind, 'area')
})

test('chatMessage carries from/name/text with placeholder seq', () => {
  const m = chatMessage('conn-7', 'Ahmed', 'hi there')
  assert.deepEqual(m, { k: 'chat', seq: 0, from: 'conn-7', name: 'Ahmed', text: 'hi there' })
})

test('shouldStoreRemoteTarget: following stores cam target, free does not', () => {
  assert.equal(shouldStoreRemoteTarget('following'), true)
  assert.equal(shouldStoreRemoteTarget('free'), false)
})

// ── CollabClient ─────────────────────────────────────────────────────────────
function makeClient(socket: FakeSocket, extra: Record<string, unknown> = {}) {
  return new CollabClient({
    code: 'ABCD',
    name: '李先生',
    role: 'viewer',
    url: 'ws://test/api/collab',
    wsFactory: () => socket,
    now: () => 1000,
    heartbeatMs: 0, // no self-ping in tests
    jitter: false,
    ...extra,
  })
}

test('onopen sends hello with code + role (no resumeSeq on first connect)', () => {
  const sock = new FakeSocket()
  const c = makeClient(sock)
  c.connect()
  sock.open()
  const hello = sock.sentJson()[0] as Record<string, unknown>
  assert.equal(hello.k, 'hello')
  assert.equal(hello.code, 'ABCD')
  assert.equal(hello.role, 'viewer')
  assert.equal(hello.name, '李先生')
  assert.equal('resumeSeq' in hello, false)
})

test('reliable messages de-dupe by seq; stale/out-of-order dropped', () => {
  const sock = new FakeSocket()
  const c = makeClient(sock)
  const got: number[] = []
  c.on('chat', (m) => {
    if (m.k === 'chat') got.push(m.seq)
  })
  c.connect()
  sock.open()
  sock.recv({ k: 'chat', seq: 1, from: 'agent', name: 'A', text: 'hi' })
  sock.recv({ k: 'chat', seq: 1, from: 'agent', name: 'A', text: 'dup' }) // duplicate
  sock.recv({ k: 'chat', seq: 2, from: 'agent', name: 'A', text: 'two' })
  sock.recv({ k: 'chat', seq: 1, from: 'agent', name: 'A', text: 'old' }) // stale
  sock.recv({ k: 'chat', seq: 4, from: 'agent', name: 'A', text: 'four' })
  assert.deepEqual(got, [1, 2, 4])
  assert.equal(c.seq, 4)
})

test('cam packets do not affect seq', () => {
  const sock = new FakeSocket()
  const c = makeClient(sock)
  let cams = 0
  c.on('cam', () => cams++)
  c.connect()
  sock.open()
  sock.recv({ k: 'chat', seq: 3, from: 'a', name: 'A', text: 'x' })
  sock.recv({ k: 'cam', t: 1, c: [55, 25], z: 13, b: 0, p: 0 })
  sock.recv({ k: 'cam', t: 2, c: [55.1, 25], z: 13, b: 0, p: 0 })
  assert.equal(cams, 2)
  assert.equal(c.seq, 3)
})

test('sync adopts connId + baseline seq', () => {
  const sock = new FakeSocket()
  const c = makeClient(sock)
  const chats: number[] = []
  c.on('chat', (m) => m.k === 'chat' && chats.push(m.seq))
  c.connect()
  sock.open()
  sock.recv({
    k: 'sync',
    connId: 'conn-7',
    state: { presenterConnId: 'p1', participants: [], recentChat: [], seq: 10 },
  })
  assert.equal(c.connId, 'conn-7')
  assert.equal(c.seq, 10)
  sock.recv({ k: 'chat', seq: 9, from: 'a', name: 'A', text: 'pre-resume stale' }) // < baseline
  sock.recv({ k: 'chat', seq: 11, from: 'a', name: 'A', text: 'new' })
  assert.deepEqual(chats, [11])
})

test('ping is answered with pong immediately; pong swallowed', () => {
  const sock = new FakeSocket()
  const c = makeClient(sock)
  c.connect()
  sock.open()
  sock.sent.length = 0 // drop the hello
  sock.recv({ k: 'ping' })
  sock.recv({ k: 'pong' })
  assert.deepEqual(sock.sentJson(), [{ k: 'pong' }])
})

test('reconnect hello carries resumeSeq = highest processed reliable seq', async () => {
  const sockets: FakeSocket[] = []
  const c = new CollabClient({
    code: 'ABCD',
    name: 'A',
    role: 'presenter',
    url: 'ws://test/api/collab',
    wsFactory: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    now: () => 1000,
    heartbeatMs: 0,
    jitter: false,
  })
  c.connect()
  sockets[0].open()
  sockets[0].recv({ k: 'goto', seq: 42, c: [55, 25], z: 14, b: 0, p: 0 })
  // server drops the connection (non-1000) → backoff reconnect (base 500ms).
  sockets[0].serverDrop(1006)
  await new Promise((r) => setTimeout(r, 600))
  assert.equal(sockets.length, 2, 'a second socket should have been opened')
  sockets[1].open()
  const hello = sockets[1].sentJson()[0] as Record<string, unknown>
  assert.equal(hello.k, 'hello')
  assert.equal(hello.resumeSeq, 42)
  assert.equal(hello.role, 'presenter')
  c.disconnect()
})

test('disconnect() prevents reconnect', async () => {
  const sockets: FakeSocket[] = []
  const c = new CollabClient({
    code: 'X',
    name: 'A',
    role: 'viewer',
    url: 'ws://t/api/collab',
    wsFactory: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    now: () => 1,
    heartbeatMs: 0,
    jitter: false,
  })
  c.connect()
  sockets[0].open()
  c.disconnect()
  await new Promise((r) => setTimeout(r, 700))
  assert.equal(sockets.length, 1, 'no reconnect after disconnect')
  assert.equal(c.state, 'closed')
})

// ── S1.5 防偷听:viewer 终止性关闭(结束/踢出/旧链接)→ onTerminal + 停止重连 ──
test('terminal ended → terminalReason + fires onTerminal + no reconnect', () => {
  const s = new FakeSocket()
  const c = makeClient(s)
  const seen: string[] = []
  c.onTerminal((r) => seen.push(r))
  c.connect(); s.open()
  s.recv({ k: 'ended' })
  assert.equal(c.terminalReason, 'ended')
  assert.deepEqual(seen, ['ended'])
  s.serverDrop(1006) // 非正常断开:普通情况会重连,但 terminal 后必须停在 closed
  assert.equal(c.state, 'closed', 'terminal stops auto-reconnect')
})

test('terminal kicked → terminalReason=kicked', () => {
  const s = new FakeSocket()
  const c = makeClient(s)
  const seen: string[] = []
  c.onTerminal((r) => seen.push(r))
  c.connect(); s.open()
  s.recv({ k: 'kicked' })
  assert.equal(c.terminalReason, 'kicked')
  assert.deepEqual(seen, ['kicked'])
})

test('terminal room_not_found (old link) → terminalReason=not_found + no reconnect', () => {
  const s = new FakeSocket()
  const c = makeClient(s)
  const seen: string[] = []
  c.onTerminal((r) => seen.push(r))
  c.connect(); s.open()
  s.recv({ k: 'error', reason: 'room_not_found' })
  assert.equal(c.terminalReason, 'not_found')
  assert.deepEqual(seen, ['not_found'])
  s.serverDrop(1006)
  assert.equal(c.state, 'closed', 'old-link viewer does not reconnect a dead room')
})

// ── viewport zoom compensation (iPad presenter → phone client) ───────────────
//
// Visible geographic width ∝ viewportWidth / 2^zoom. Adopting the presenter's zoom
// verbatim on a smaller screen shows LESS ground than they see — the agent says
// "look at this whole community" and the client's phone only has the middle of it.
// This is the common case (agents present on iPads, clients watch on phones).

test('zoomOffsetForViewport: phone viewer sees at least what the iPad presenter sees', () => {
  const iPad = { vw: 1180, vh: 820 }
  const dz = zoomOffsetForViewport(iPad, 390, 844) // phone
  assert.ok(dz < 0, 'phone must zoom OUT to cover the same ground')

  const pz = 13
  const vz = pz + dz
  const presW = iPad.vw / 2 ** pz
  const viewW = 390 / 2 ** vz
  const presH = iPad.vh / 2 ** pz
  const viewH = 844 / 2 ** vz

  // superset: the viewer may see MORE than the presenter, never less
  assert.ok(viewW >= presW - 1e-9, 'viewer width covers presenter width')
  assert.ok(viewH >= presH - 1e-9, 'viewer height covers presenter height')

  // and without compensation the phone would see only ~1/3 of the width
  assert.ok(390 / 2 ** pz < presW * 0.4, 'uncompensated phone is badly cropped')
})

test('zoomOffsetForViewport: identical viewports → no change', () => {
  assert.equal(zoomOffsetForViewport({ vw: 800, vh: 600 }, 800, 600), 0)
})

test('zoomOffsetForViewport: missing/bogus sizes degrade to 0, never a wild zoom', () => {
  assert.equal(zoomOffsetForViewport(undefined, 390, 844), 0, 'old client sent no vw/vh')
  assert.equal(zoomOffsetForViewport({}, 390, 844), 0)
  assert.equal(zoomOffsetForViewport({ vw: 1180, vh: 820 }, 0, 0), 0, 'collapsed container')
  // absurd ratio (hidden container reporting ~1px) must not produce a huge jump
  assert.equal(zoomOffsetForViewport({ vw: 40000, vh: 40000 }, 390, 844), 0)
})

// ── ring replay on resume (regression) ──────────────────────────────────────
//
// The server replies `sync` and THEN replays ring messages with seq > resumeSeq.
// The client used to adopt state.seq from the snapshot unconditionally, which
// pushed lastSeq to the NEWEST event — so every replayed message then failed the
// `seq <= lastSeq` de-dupe and was silently dropped. Replay was dead: a
// reconnecting client recovered nothing.

test('resume: replayed ring messages after sync are NOT dropped', () => {
  const sock = new FakeSocket()
  const c = makeClient(sock)
  const got: string[] = []
  c.on('chat', (m) => { if (m.k === 'chat') got.push(m.text) })

  c.connect()
  sock.open()
  // establish a baseline: we've processed up to seq 5
  sock.recv({ k: 'sync', connId: 'me', state: { presenterConnId: 'p', participants: [], recentChat: [], seq: 5 } })
  sock.recv({ k: 'chat', seq: 6, from: 'a', name: 'A', text: 'before-drop' })
  assert.equal(c.seq, 6)

  // reconnect → hello carries resumeSeq=6; server sends a FRESH sync (seq now 9)
  // and then replays 7,8,9.
  sock.serverDrop(1006)
  const sock2 = new FakeSocket()
  ;(c as unknown as { wsFactory: (u: string) => CollabSocket }).wsFactory = () => sock2
  c.connect()
  sock2.open()
  const hello = sock2.sentJson()[0] as Record<string, unknown>
  assert.equal(hello.resumeSeq, 6, 'resume asks for everything after 6')

  sock2.recv({ k: 'sync', connId: 'me', state: { presenterConnId: 'p', participants: [], recentChat: [], seq: 9 } })
  sock2.recv({ k: 'chat', seq: 7, from: 'a', name: 'A', text: 'replay-7' })
  sock2.recv({ k: 'chat', seq: 8, from: 'a', name: 'A', text: 'replay-8' })
  sock2.recv({ k: 'chat', seq: 9, from: 'a', name: 'A', text: 'replay-9' })

  assert.deepEqual(got, ['before-drop', 'replay-7', 'replay-8', 'replay-9'],
    'replayed messages must be delivered, not swallowed by the snapshot seq')
})

test('fresh connect: snapshot seq IS adopted (no replay expected)', () => {
  const sock = new FakeSocket()
  const c = makeClient(sock)
  const got: number[] = []
  c.on('chat', (m) => { if (m.k === 'chat') got.push(m.seq) })
  c.connect()
  sock.open()
  sock.recv({ k: 'sync', connId: 'me', state: { presenterConnId: 'p', participants: [], recentChat: [], seq: 20 } })
  assert.equal(c.seq, 20, 'fresh joiner adopts the room seq')
  sock.recv({ k: 'chat', seq: 15, from: 'a', name: 'A', text: 'stale' })
  sock.recv({ k: 'chat', seq: 21, from: 'a', name: 'A', text: 'new' })
  assert.deepEqual(got, [21], 'pre-join history is not re-delivered')
})

test('sync carries materialized marks so a late joiner sees existing drawings', () => {
  const sock = new FakeSocket()
  const c = makeClient(sock)
  let marks: unknown[] | undefined
  c.on('sync', (m) => { if (m.k === 'sync') marks = m.state.marks })
  c.connect()
  sock.open()
  sock.recv({
    k: 'sync', connId: 'me',
    state: {
      presenterConnId: 'p', participants: [], recentChat: [], seq: 3,
      marks: [{ id: 'm1', kind: 'circle' }, { id: 'm2', kind: 'pen' }],
    },
  })
  assert.deepEqual(marks, [{ id: 'm1', kind: 'circle' }, { id: 'm2', kind: 'pen' }])
})
