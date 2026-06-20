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
