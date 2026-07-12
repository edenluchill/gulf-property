/**
 * Collab 应用内语音 + 经纪单向视频(Agora)—— 带成本护栏。
 *
 * 语音成本护栏(服务端硬 enforce,这里只是客户端配合):
 *   • token TTL = 服务端给的 allowed/remaining 秒 → 过期 Agora 自动断
 *   • 客户端额外跑倒计时,到点主动 leave('limit')
 *   • presenter 每 30s 心跳回填用量(崩溃也记到最近一次)
 *
 * ── 视频(经纪开摄像头拍沙盘/自拍,客户**只观看不推流**)────────────────────
 * 客户端永不调 createCameraVideoTrack() → 浏览器**不会**向客户请求摄像头权限。
 *
 * 视频成本护栏(三层,见 docs/collab-live-video-spec.md §3.5):
 *   ① 软:同时观看 ≤ MAX_VIDEO_VIEWERS(6)—— Agora 频道内人数超了就禁用摄像头。
 *      client.remoteUsers.length 是**精确计费口径**:只有真进了频道的人才产生费用。
 *   ② 硬:heartbeat 每 30s 上报观看人数 → 服务端实时结算 → 额度耗尽返回 stopVideo
 *      → 这里立即 unpublish 视频轨,Agora **当场**停止计费。语音不受影响。
 *   ③ 硬:单场 30min token TTL(已有)。
 *
 * 计费单位是 viewer-minute(观看人数 × 分钟):Agora 按「订阅」计费,经纪推流不花钱,
 * 只有客户观看才计,成本按人头线性涨。
 *
 * Agora SDK 动态 import —— 只在真正开语音时才加载那个大 chunk(守 bundle)。
 * ISOLATION: 纯客户端;删 collab 目录即移除。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  IAgoraRTCClient, IMicrophoneAudioTrack, IAgoraRTCRemoteUser,
  ICameraVideoTrack, IRemoteVideoTrack,
} from 'agora-rtc-sdk-ng'
import { API_BASE_URL } from '../../lib/config'

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'limit' | 'unavailable' | 'no_session' | 'error'

/** 摄像头不可用的原因(决定按钮的 title 文案)。 */
export type VideoBlock = null | 'quota' | 'viewers' | 'upgrade'

/** 同时观看视频的客户数上限(与后端 voiceRtc.MAX_VIDEO_VIEWERS 对齐)。 */
export const MAX_VIDEO_VIEWERS = 6

export interface UseCollabVoiceOpts {
  mode: 'browse' | 'presenter' | 'viewer'
  roomCode?: string
  agentEmail?: string
}

export interface CollabVoiceApi {
  status: VoiceStatus
  muted: boolean
  /** countdown to the session cap (seconds); 0 when idle */
  remainingSeconds: number
  /** presenter: start a call (mints session + token); viewer: join the active call */
  connect: () => void
  leave: () => void
  toggleMute: () => void

  // ── 视频(presenter 推流 / viewer 观看)──────────────────────────────────
  /** presenter: 摄像头是否开着 */
  cameraOn: boolean
  /** presenter: 前置(自拍) / 后置(拍沙盘) */
  facing: 'user' | 'environment'
  /** presenter: 开/关摄像头。额度不足或人数超限时是 no-op */
  toggleCamera: () => void
  /** presenter: 前后置切换(重建 track —— iOS Safari 上 switchDevice 会静默失败) */
  flipCamera: () => void
  /** presenter: 切换中(黑屏 ~300ms,UI 盖 loading) */
  flipping: boolean
  /** presenter 本地预览轨 */
  localVideo: ICameraVideoTrack | null
  /** viewer 收到的经纪视频轨 */
  remoteVideo: IRemoteVideoTrack | null
  /** presenter: 当前正在看视频的客户数(= Agora 频道内远端人数) */
  videoViewers: number
  /** presenter: 摄像头为何不可用(null = 可用) */
  videoBlock: VideoBlock
  /** presenter: 本月剩余免费视频分钟(Infinity = 无限) */
  videoFreeLeft: number
}

const BASE = `${API_BASE_URL}/api/voice-rtc`

export function useCollabVoice({ mode, roomCode, agentEmail }: UseCollabVoiceOpts): CollabVoiceApi {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [muted, setMuted] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(0)

  // ── 视频 state ────────────────────────────────────────────────────────────
  const [cameraOn, setCameraOn] = useState(false)
  const [facing, setFacing] = useState<'user' | 'environment'>('environment') // 默认后置:主用途是拍沙盘
  const [flipping, setFlipping] = useState(false)
  const [localVideo, setLocalVideo] = useState<ICameraVideoTrack | null>(null)
  const [remoteVideo, setRemoteVideo] = useState<IRemoteVideoTrack | null>(null)
  const [videoViewers, setVideoViewers] = useState(0)
  const [videoBlock, setVideoBlock] = useState<VideoBlock>(null)
  const [videoFreeLeft, setVideoFreeLeft] = useState(0)

  const clientRef = useRef<IAgoraRTCClient | null>(null)
  const micRef = useRef<IMicrophoneAudioTrack | null>(null)
  const camRef = useRef<ICameraVideoTrack | null>(null)
  const sessionIdRef = useRef<number | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const leavingRef = useRef(false)
  /** heartbeat 里读得到的最新 cameraOn(闭包会捕获旧值,必须用 ref) */
  const cameraOnRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null }
  }, [])

  /** 撤掉摄像头:unpublish + close。Agora **当场**停止计费。语音不受影响。 */
  const stopCamera = useCallback(async (block: VideoBlock = null) => {
    const cam = camRef.current
    camRef.current = null
    cameraOnRef.current = false
    setCameraOn(false)
    setLocalVideo(null)
    if (block) setVideoBlock(block)
    if (!cam) return
    try { await clientRef.current?.unpublish([cam]) } catch { /* ignore */ }
    try { cam.stop(); cam.close() } catch { /* ignore */ }
  }, [])

  const teardown = useCallback(async (reason: string, nextStatus: VoiceStatus) => {
    if (leavingRef.current) return
    leavingRef.current = true
    clearTimers()
    const sid = sessionIdRef.current
    await stopCamera()
    try { micRef.current?.stop(); micRef.current?.close() } catch { /* ignore */ }
    try { await clientRef.current?.leave() } catch { /* ignore */ }
    micRef.current = null
    clientRef.current = null
    // presenter owns the DB session row → finalize it
    if (mode === 'presenter' && sid != null) {
      navigator.sendBeacon?.(`${BASE}/end`, new Blob([JSON.stringify({ sessionId: sid, reason })], { type: 'application/json' }))
    }
    sessionIdRef.current = null
    setMuted(false)
    setRemainingSeconds(0)
    setRemoteVideo(null)
    setVideoViewers(0)
    setVideoBlock(null)
    setStatus(nextStatus)
    leavingRef.current = false
  }, [mode, clearTimers, stopCamera])

  const leave = useCallback(() => { void teardown('left', 'idle') }, [teardown])

  /** presenter: 拉取本月视频额度(点亮/置灰摄像头按钮)。 */
  const refreshVideoQuota = useCallback(async () => {
    if (mode !== 'presenter' || !agentEmail) return
    try {
      const res = await fetch(`${BASE}/video-quota?email=${encodeURIComponent(agentEmail)}`)
      const q = await res.json().catch(() => null)
      if (!q?.ok) return
      setVideoFreeLeft(q.freeLeft ?? 0)
      setVideoBlock(q.needsUpgrade ? 'upgrade' : q.exhausted ? 'quota' : null)
    } catch { /* 拿不到额度就不改按钮态 —— heartbeat 会兜底刹车 */ }
  }, [mode, agentEmail])

  /**
   * presenter: 建一条摄像头轨并推流。
   *
   * 480p 而不是 720p:Agora **没有 SD 档**,480p 与 720p 同价(都落 HD 档 ≤921,600px)
   * → 降分辨率省不了我们的钱,但**省客户一半流量**(30min: 250MB → 110MB)。
   * 客户全在手机上看 240×180 的小画中画,720p 的像素根本落不到屏幕上。
   * ⚠️ 绝不上 1080p —— 越过 921,600px 阈值 = 2.25 倍价钱。
   */
  const publishCamera = useCallback(async (dir: 'user' | 'environment') => {
    const client = clientRef.current
    if (!client) return
    const AgoraRTC = (await import('agora-rtc-sdk-ng')).default
    const cam = await AgoraRTC.createCameraVideoTrack({
      facingMode: dir,
      encoderConfig: '480p_1',
    })
    camRef.current = cam
    await client.publish([cam])
    cameraOnRef.current = true
    setLocalVideo(cam)
    setCameraOn(true)
    setVideoBlock(null)
  }, [])

  const toggleCamera = useCallback(async () => {
    if (mode !== 'presenter' || status !== 'live') return
    if (cameraOnRef.current) return void stopCamera()

    // 护栏 ①:同时观看人数上限。超了直接不给开 —— 一旦 publish,频道里**所有**人
    // 都会订阅,没法只给其中 6 个看(成本按人头涨)。
    const viewers = clientRef.current?.remoteUsers.length ?? 0
    if (viewers > MAX_VIDEO_VIEWERS) return setVideoBlock('viewers')

    // 护栏 ②:额度预检(heartbeat 是兜底,这里是即时反馈)
    await refreshVideoQuota()
    try {
      const res = await fetch(`${BASE}/video-quota?email=${encodeURIComponent(agentEmail || '')}`)
      const q = await res.json().catch(() => null)
      if (q?.ok && q.exhausted) return setVideoBlock(q.needsUpgrade ? 'upgrade' : 'quota')
    } catch { /* 预检失败不拦 —— heartbeat 30s 内会刹车 */ }

    try {
      await publishCamera(facing)
    } catch (err) {
      console.error('[collab-voice] camera failed', err)
      setVideoBlock(null)
      void stopCamera()
    }
  }, [mode, status, facing, agentEmail, stopCamera, publishCamera, refreshVideoQuota])

  /**
   * 前后置切换 —— 必须**重建** track。
   * ⚠️ 不能用 cam.setDevice()/switchDevice() 换 facingMode:iOS Safari 上会静默失败
   *    (promise resolve 了但画面不变)。经纪主力设备是 iPad,这条必须守。
   */
  const flipCamera = useCallback(async () => {
    if (!cameraOnRef.current || flipping) return
    const next = facing === 'environment' ? 'user' : 'environment'
    setFlipping(true)
    setFacing(next)
    try {
      await stopCamera()
      await publishCamera(next)
    } catch (err) {
      console.error('[collab-voice] flip failed', err)
    } finally {
      setFlipping(false)
    }
  }, [facing, flipping, stopCamera, publishCamera])

  const connect = useCallback(async () => {
    if (mode === 'browse' || !roomCode) return
    if (clientRef.current || status === 'connecting') return
    setStatus('connecting')

    // 1) get a token from the server (enforces all the limits)
    let data: any
    try {
      const path = mode === 'presenter' ? '/start' : '/viewer-token'
      const body = mode === 'presenter' ? { roomCode, agentEmail } : { roomCode }
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        if (res.status === 429) return setStatus('limit')
        if (res.status === 503) return setStatus('unavailable')
        if (res.status === 409) return setStatus('no_session')
        return setStatus('error')
      }
    } catch {
      return setStatus('error')
    }

    const ttl: number = data.allowedSeconds ?? data.remainingSeconds ?? 0
    sessionIdRef.current = data.sessionId ?? null

    // 2) join the Agora channel + publish mic (SDK loaded on demand)
    try {
      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
      clientRef.current = client

      // presenter 的观看人数 = 频道内远端人数。这是**精确的计费口径**:
      // 房间里可能有 20 人,但只有接通了语音、真进了 Agora 频道的人才订阅视频、
      // 才产生费用。用 remoteUsers 而不是 collab 房间的 participants。
      const syncViewers = () => setVideoViewers(client.remoteUsers.length)

      client.on('user-published', async (user: IAgoraRTCRemoteUser, mediaType) => {
        try {
          await client.subscribe(user, mediaType)
          if (mediaType === 'audio') user.audioTrack?.play()
          // viewer 收经纪的视频。客户端**从不** publish 视频 → 不弹摄像头权限。
          if (mediaType === 'video') setRemoteVideo(user.videoTrack ?? null)
        } catch { /* ignore */ }
      })
      client.on('user-unpublished', (_user: IAgoraRTCRemoteUser, mediaType) => {
        // 经纪关摄像头 → 视频窗自动收起
        if (mediaType === 'video') setRemoteVideo(null)
      })
      client.on('user-joined', syncViewers)
      client.on('user-left', () => {
        syncViewers()
        setRemoteVideo((v) => (client.remoteUsers.length ? v : null))
      })

      await client.join(data.appId, data.channel, data.token, null)
      const mic = await AgoraRTC.createMicrophoneAudioTrack()
      micRef.current = mic
      await client.publish([mic])
      syncViewers()
    } catch (err) {
      console.error('[collab-voice] join failed', err)
      return void teardown('error', 'error')
    }

    setMuted(false)
    setStatus('live')

    // 3) countdown to the cap; hard-leave at 0
    setRemainingSeconds(ttl)
    countdownRef.current = setInterval(() => {
      setRemainingSeconds((s) => {
        if (s <= 1) { void teardown('limit', 'limit'); return 0 }
        return s - 1
      })
    }, 1000)

    // 4) presenter heartbeat —— 语音用量回填 + **视频实时结算/刹车**
    if (mode === 'presenter') {
      void refreshVideoQuota()
      heartbeatRef.current = setInterval(async () => {
        const sid = sessionIdRef.current
        if (sid == null) return
        // 摄像头开着才上报观看人数 → 服务端才结算视频用量
        const viewers = cameraOnRef.current ? (clientRef.current?.remoteUsers.length ?? 0) : undefined
        try {
          const res = await fetch(`${BASE}/heartbeat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: sid, videoViewers: viewers }),
          })
          if (viewers === undefined || res.status === 204) return
          const r = await res.json().catch(() => null)
          if (!r) return
          if (typeof r.freeLeft === 'number') setVideoFreeLeft(r.freeLeft)
          // ⭐ 成本刹车:额度+积分都空了 → 立即撤视频轨,Agora 当场停止计费。
          //    语音继续,带看不中断。
          if (r.stopVideo) void stopCamera('quota')
        } catch { /* 网络抖动不刹车 —— 下个心跳会再判一次(最多多烧 30s) */ }
      }, 30_000)
    }
  }, [mode, roomCode, agentEmail, status, teardown, stopCamera, refreshVideoQuota])

  const toggleMute = useCallback(() => {
    const mic = micRef.current
    if (!mic) return
    const next = !muted
    void mic.setMuted(next)
    setMuted(next)
  }, [muted])

  // 护栏 ①(运行中):摄像头开着时人数涨过上限 → 自动关。
  // 一旦 publish,频道里所有人都会订阅,没法只给 6 个看 —— 成本是按人头涨的。
  useEffect(() => {
    if (cameraOn && videoViewers > MAX_VIDEO_VIEWERS) void stopCamera('viewers')
  }, [cameraOn, videoViewers, stopCamera])

  // leave on unmount / when the collab session ends (mode → browse)
  useEffect(() => {
    if (mode === 'browse' && clientRef.current) void teardown('left', 'idle')
  }, [mode, teardown])
  useEffect(() => () => { void teardown('left', 'idle') }, [teardown])

  return {
    status, muted, remainingSeconds, connect, leave, toggleMute,
    cameraOn, facing, toggleCamera, flipCamera, flipping,
    localVideo, remoteVideo, videoViewers, videoBlock, videoFreeLeft,
  }
}
