/**
 * 分享渠道品牌图标 (2026-07-14) — 用品牌色 + 特征形状自绘,不依赖外部图标库。
 * 微信绿双气泡 / 朋友圈彩虹圈 / 小红书红底白字 / 抖音黑底音符。
 */

export type ChannelKey = 'wechat' | 'moments' | 'xhs' | 'douyin'

export default function ShareChannelIcon({ channel }: { channel: ChannelKey }) {
  const box = 'w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 shadow-sm'
  switch (channel) {
    case 'wechat':
      return (
        <div className={box} style={{ background: '#07C160' }}>
          <svg viewBox="0 0 32 32" className="w-5 h-5" fill="#fff" aria-hidden>
            {/* 大气泡 */}
            <path d="M12.5 6C7 6 2.6 9.7 2.6 14.2c0 2.5 1.4 4.8 3.6 6.3l-.9 2.8 3.3-1.7c1.2.3 2.5.5 3.9.5.4 0 .8 0 1.2-.1a7.7 7.7 0 0 1-.3-2.1c0-4.2 4-7.5 9-7.5.5 0 1 0 1.5.1C22.6 8.7 18 6 12.5 6Z" />
            {/* 小气泡 */}
            <path d="M29.4 18.6c0-3.6-3.5-6.5-7.9-6.5s-7.9 2.9-7.9 6.5 3.5 6.5 7.9 6.5c.9 0 1.8-.1 2.7-.4l2.6 1.4-.7-2.3c1.9-1.2 3.3-3 3.3-4.7Z" />
            {/* 大气泡眼睛(绿点) */}
            <circle cx="9" cy="13" r="1.1" fill="#07C160" />
            <circle cx="16" cy="13" r="1.1" fill="#07C160" />
            {/* 小气泡眼睛 */}
            <circle cx="19" cy="17.5" r="1" fill="#07C160" />
            <circle cx="24" cy="17.5" r="1" fill="#07C160" />
          </svg>
        </div>
      )
    case 'moments':
      // 朋友圈:标志性彩虹圈
      return (
        <div className="w-9 h-9 rounded-2xl bg-white ring-1 ring-slate-200 flex items-center justify-center shrink-0 shadow-sm">
          <div className="w-5 h-5 rounded-full" style={{ background: 'conic-gradient(#f43f5e,#f59e0b,#22c55e,#3b82f6,#a855f7,#f43f5e)' }}>
            <div className="w-2 h-2 rounded-full bg-white m-auto" style={{ marginTop: 6 }} />
          </div>
        </div>
      )
    case 'xhs':
      return (
        <div className={box} style={{ background: '#FF2442' }}>
          <span className="text-white font-black leading-none tracking-tight" style={{ fontSize: 9 }}>小红书</span>
        </div>
      )
    case 'douyin':
      return (
        <div className={`${box} relative`} style={{ background: '#000' }}>
          {/* 音符 + 青/品红错位(抖音特征) */}
          <span className="absolute text-lg font-bold" style={{ color: '#25F4EE', transform: 'translate(-1.5px,-0.5px)' }}>♪</span>
          <span className="absolute text-lg font-bold" style={{ color: '#FE2C55', transform: 'translate(1.5px,0.5px)' }}>♪</span>
          <span className="relative text-lg font-bold text-white">♪</span>
        </div>
      )
  }
}
