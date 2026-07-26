/**
 * 带看提示音 —— 纯 WebAudio 合成,不拉任何外部音频资源(墙内零加载 + 零 bundle 体积)。
 *
 * owner:「进来了有提示音啊,诸如此类的」。用途:有人进带看 / 语音接通 / 有人离开,
 * 给个轻轻的一声,让经纪和买家知道「有动静了」。刻意克制:短、轻、不打断说话。
 *
 * iOS/Safari:AudioContext 必须在一次用户手势后才能出声。买家点「进入带看」「和经纪
 * 通话」本身就是手势 → 那之后就解锁了。没解锁就静默失败(catch),绝不报错、绝不挡路。
 */
let ctx: AudioContext | null = null

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch { return null }
}

/** 一次用户手势里调一下,提前解锁 iOS 的音频(可选,不调也行)。 */
export function unlockChimes(): void { ac() }

/** 两个短音的小和弦。gain 很低(0.06),只是「叮」一下,不吵。 */
function play(notes: { freq: number; at: number; dur: number }[]): void {
  const c = ac()
  if (!c) return
  try {
    const now = c.currentTime
    for (const n of notes) {
      const osc = c.createOscillator()
      const g = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = n.freq
      g.gain.setValueAtTime(0, now + n.at)
      g.gain.linearRampToValueAtTime(0.06, now + n.at + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.dur)
      osc.connect(g); g.connect(c.destination)
      osc.start(now + n.at)
      osc.stop(now + n.at + n.dur + 0.02)
    }
  } catch { /* 出不了声就算了,绝不抛 */ }
}

/** 有人进带看 / 语音接通 —— 上行两声(欢快)。 */
export function chimeJoin(): void {
  play([{ freq: 587.33, at: 0, dur: 0.14 }, { freq: 880, at: 0.09, dur: 0.16 }]) // D5 → A5
}
/** 有人离开 —— 下行一声(轻)。 */
export function chimeLeave(): void {
  play([{ freq: 493.88, at: 0, dur: 0.16 }, { freq: 329.63, at: 0.08, dur: 0.18 }]) // B4 → E4
}
