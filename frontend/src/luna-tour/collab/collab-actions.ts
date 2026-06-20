/**
 * Luna Collaborative Tour — pure decision helpers (UI-agnostic).
 *
 * The integration glue (MapPage) is hard to unit-test, so the *decisions* that
 * sit at the seam between MapPage handlers and the wire protocol are factored
 * out here as pure functions and covered by collab.test.ts. No React, no
 * maplibre, no socket — just data → message / mode → effect.
 *
 * ISOLATION: imports only protocol types. Delete with the collab directory.
 */
import type { ClientMsg, SelectKind } from './protocol'

/** Mirrors useCollabFollow's FollowMode without importing the React hook. */
export type FollowModeLike = 'following' | 'free'

/**
 * What the presenter should broadcast when the user selects a project or area.
 * `seq:0` is a placeholder — the server stamps the real monotone seq (§5).
 */
export function selectMessage(kind: SelectKind, id: string, tab?: string): ClientMsg {
  return { k: 'select', seq: 0, kind, id, ...(tab ? { tab } : {}) }
}

/** What the presenter should broadcast as a chat line. */
export function chatMessage(from: string, name: string, text: string): ClientMsg {
  return { k: 'chat', seq: 0, from, name, text }
}

/**
 * Should an incoming `cam`/`goto` update the local follow target?
 * Following → yes (drive the camera). Free → no (user is exploring; we never
 * yank them). returnToPresenter re-arms following separately.
 */
export function shouldStoreRemoteTarget(mode: FollowModeLike): boolean {
  return mode === 'following'
}
