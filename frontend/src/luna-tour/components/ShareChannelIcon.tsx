/**
 * 分享渠道品牌图标 (2026-07-14) — 用品牌色 + 特征形状自绘,不依赖外部图标库。
 * 中文:微信/小红书/抖音;英文(海外):WhatsApp/Instagram/TikTok/Facebook。
 */

export type ChannelKey =
  | 'wechat' | 'xhs' | 'douyin'                         // 中文
  | 'whatsapp' | 'instagram' | 'tiktok' | 'facebook'    // 海外

const BOX = 'w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 shadow-sm relative overflow-hidden'

// 抖音/TikTok 共用:黑底 + 青/品红错位音符
function NoteMark() {
  return (
    <>
      <span className="absolute text-lg font-bold" style={{ color: '#25F4EE', transform: 'translate(-1.5px,-0.5px)' }}>♪</span>
      <span className="absolute text-lg font-bold" style={{ color: '#FE2C55', transform: 'translate(1.5px,0.5px)' }}>♪</span>
      <span className="relative text-lg font-bold text-white">♪</span>
    </>
  )
}

export default function ShareChannelIcon({ channel }: { channel: ChannelKey }) {
  switch (channel) {
    case 'wechat':
      return (
        <div className={BOX} style={{ background: '#07C160' }}>
          <svg viewBox="0 0 32 32" className="w-5 h-5" fill="#fff" aria-hidden>
            <path d="M12.5 6C7 6 2.6 9.7 2.6 14.2c0 2.5 1.4 4.8 3.6 6.3l-.9 2.8 3.3-1.7c1.2.3 2.5.5 3.9.5.4 0 .8 0 1.2-.1a7.7 7.7 0 0 1-.3-2.1c0-4.2 4-7.5 9-7.5.5 0 1 0 1.5.1C22.6 8.7 18 6 12.5 6Z" />
            <path d="M29.4 18.6c0-3.6-3.5-6.5-7.9-6.5s-7.9 2.9-7.9 6.5 3.5 6.5 7.9 6.5c.9 0 1.8-.1 2.7-.4l2.6 1.4-.7-2.3c1.9-1.2 3.3-3 3.3-4.7Z" />
            <circle cx="9" cy="13" r="1.1" fill="#07C160" />
            <circle cx="16" cy="13" r="1.1" fill="#07C160" />
            <circle cx="19" cy="17.5" r="1" fill="#07C160" />
            <circle cx="24" cy="17.5" r="1" fill="#07C160" />
          </svg>
        </div>
      )
    case 'xhs':
      return (
        <div className={BOX} style={{ background: '#FF2442' }}>
          <span className="text-white font-black leading-none tracking-tight" style={{ fontSize: 9 }}>小红书</span>
        </div>
      )
    case 'douyin':
    case 'tiktok':
      return <div className={BOX} style={{ background: '#000' }}><NoteMark /></div>
    case 'whatsapp':
      return (
        <div className={BOX} style={{ background: '#25D366' }}>
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#fff" aria-hidden>
            <path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-2-1.2 7.4 7.4 0 0 1-1.4-1.7c-.1-.3 0-.4.1-.5l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.2-.9.9-.9 2.2s.9 2.5 1.1 2.7c.1.2 1.9 2.9 4.5 4 .6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.1-.2-.2-.5-.3Z" />
          </svg>
        </div>
      )
    case 'instagram':
      return (
        <div className={BOX} style={{ background: 'linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)' }}>
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="#fff" strokeWidth="2" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="5.5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.3" cy="6.7" r="1.1" fill="#fff" stroke="none" />
          </svg>
        </div>
      )
    case 'facebook':
      return (
        <div className={BOX} style={{ background: '#1877F2' }}>
          <span className="text-white font-black text-xl leading-none" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>f</span>
        </div>
      )
  }
}
