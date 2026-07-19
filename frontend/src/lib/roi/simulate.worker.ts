/**
 * 蒙特卡洛 Worker。1 万次 × 最长 15 年 × 7 个年限档 ≈ 几十万次 IRR 二分,
 * 在主线程上是 200–400ms 的**整块卡顿** —— 滑块会粘手。
 *
 * 协议极简(不引 Comlink):{ id, params } → { id, ok, result | error }。
 * id 用来丢弃过期结果:用户连拖滑块会发多次,只有最后一次算数。
 */
import { simulate, type SimParams, type SimResult } from './simulate'

export interface SimRequest {
  id: number
  params: SimParams
}
export type SimResponse =
  | { id: number; ok: true; result: SimResult; ms: number }
  | { id: number; ok: false; error: string }

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const { id, params } = e.data
  const t0 = performance.now()
  try {
    const result = simulate(params)
    const msg: SimResponse = { id, ok: true, result, ms: performance.now() - t0 }
    ;(self as unknown as Worker).postMessage(msg)
  } catch (err) {
    const msg: SimResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    ;(self as unknown as Worker).postMessage(msg)
  }
}
