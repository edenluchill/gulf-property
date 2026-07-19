/**
 * useSimulation —— 把蒙特卡洛跑在 Worker 里的 React 封装。
 *
 * 三件事:
 *  1. 单例 Worker(每次重算新建一个 Worker 要 ~20ms 启动 + 重新解析模块)
 *  2. 请求 id 单调递增,只接受最新一次的结果 —— 拖滑块会连发,旧结果晚到会把
 *     图表打回上一帧
 *  3. Worker 起不来(老浏览器/CSP)就**同步降级**跑主线程。宁可卡 300ms 也不能
 *     整页没结果。
 */
import { useEffect, useRef, useState } from 'react'
import { simulate, type SimParams, type SimResult } from './simulate'
import type { SimRequest, SimResponse } from './simulate.worker'

export interface SimState {
  result: SimResult | null
  running: boolean
  /** 最近一次耗时(ms),用来在 dev 里确认没退化 */
  ms: number | null
  error: string | null
}

export function useSimulation(params: SimParams | null, debounceMs = 180): SimState {
  const [state, setState] = useState<SimState>({ result: null, running: false, ms: null, error: null })
  const workerRef = useRef<Worker | null>(null)
  const seqRef = useRef(0)
  const latestRef = useRef(0)

  useEffect(() => {
    let w: Worker | null = null
    try {
      w = new Worker(new URL('./simulate.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<SimResponse>) => {
        const d = e.data
        if (d.id !== latestRef.current) return // 过期结果,丢弃
        if (d.ok) setState({ result: d.result, running: false, ms: d.ms, error: null })
        else setState((s) => ({ ...s, running: false, error: d.error }))
      }
      w.onerror = () => {
        workerRef.current = null // 之后走主线程降级
      }
      workerRef.current = w
    } catch {
      workerRef.current = null
    }
    return () => {
      w?.terminate()
      workerRef.current = null
    }
  }, [])

  const key = params ? JSON.stringify(params) : ''
  useEffect(() => {
    if (!params) {
      setState({ result: null, running: false, ms: null, error: null })
      return
    }
    setState((s) => ({ ...s, running: true, error: null }))
    const timer = setTimeout(() => {
      const id = ++seqRef.current
      latestRef.current = id
      const w = workerRef.current
      if (w) {
        const req: SimRequest = { id, params }
        w.postMessage(req)
        return
      }
      // 降级:主线程同步跑
      try {
        const t0 = performance.now()
        const result = simulate(params)
        if (id !== latestRef.current) return
        setState({ result, running: false, ms: performance.now() - t0, error: null })
      } catch (err) {
        setState((s) => ({ ...s, running: false, error: err instanceof Error ? err.message : String(err) }))
      }
    }, debounceMs)
    return () => clearTimeout(timer)
    // params 是每次渲染新建的对象,用序列化后的 key 做依赖,否则每帧重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs])

  return state
}
