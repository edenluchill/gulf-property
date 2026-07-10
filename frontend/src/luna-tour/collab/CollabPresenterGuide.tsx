/**
 * Luna Collaborative Tour — presenter onboarding card.
 *
 * Problem it solves: after "开始带看" the agent just lands on the map and thinks
 * nothing happened — they don't realise they must SEND the link to a client for
 * anyone to follow. This is a prominent, dismissible card that makes the one
 * required action obvious (share the link), shows a live "waiting for client"
 * state, and flips to "client joined" the moment a viewer connects.
 *
 * Shown only to the presenter, only until dismissed. Pure presentational.
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Radio, Copy, Check, X, Users, Loader2 } from 'lucide-react'

const ACCENT = '#00E0B8'

export interface CollabPresenterGuideProps {
  shareUrl?: string
  copied?: boolean
  onCopyShare?: () => void
  /** a client (viewer) has joined the room */
  hasViewer: boolean
  onDismiss: () => void
}

export default function CollabPresenterGuide({
  shareUrl,
  copied,
  onCopyShare,
  hasViewer,
  onDismiss,
}: CollabPresenterGuideProps) {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)
  // Auto-dismiss shortly after the first client joins — the job is done.
  useEffect(() => {
    if (!hasViewer) return
    const t = setTimeout(onDismiss, 2400)
    return () => clearTimeout(t)
  }, [hasViewer, onDismiss])

  return (
    <AnimatePresence>
      <motion.div
        key="collab-guide"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-[1010] flex items-center justify-center p-4"
        style={{ background: 'rgba(2,6,12,0.55)', backdropFilter: 'blur(2px)' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="relative w-full max-w-md overflow-hidden rounded-2xl bg-[#0b1220] text-white shadow-2xl ring-1 ring-white/10"
        >
          {/* accent header */}
          <div className="relative px-6 pt-6 pb-4" style={{ background: `linear-gradient(135deg, ${ACCENT}22, transparent)` }}>
            <button
              onClick={onDismiss}
              className="absolute right-3 top-3 rounded-full p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
              aria-label={L('关闭', 'Close')}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${ACCENT}22`, color: ACCENT }}>
                <Radio className="h-5 w-5" />
              </span>
              <div>
                <div className="text-base font-semibold">{L('实时带看已开启', 'Live tour is on')}</div>
                <div className="text-xs text-white/50">{L('就差最后一步 —— 把链接发给客户', 'One last step — send the link to your client')}</div>
              </div>
            </div>
          </div>

          <div className="px-6 pb-6">
            {!hasViewer ? (
              <>
                <p className="mt-1 text-sm leading-relaxed text-white/70">
                  {L('客户', 'Once your client')}<span className="font-semibold text-white"> {L('打开这条链接', 'opens this link')} </span>
                  {L('后,就能实时跟着你看房 —— 你拖地图、点项目、讲解,他们屏幕同步跟随。',
                     ', they follow your tour live — you drag the map, tap projects and explain, and their screen syncs to yours.')}
                  <span className="mt-1 block text-white/45">
                    {L('链接是你的专属固定链接,每次带看都一样,客户存下来随时能再进。',
                       'This is your permanent personal link — the same every time, so clients can save it and rejoin anytime.')}
                  </span>
                </p>

                {/* the link + copy(主操作)*/}
                <div className="mt-4 flex items-center gap-2 rounded-xl bg-black/40 px-3 py-2.5 ring-1 ring-white/10">
                  <code className="min-w-0 flex-1 truncate text-[13px] text-white/85">{shareUrl}</code>
                  <button
                    onClick={onCopyShare}
                    className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 transition hover:opacity-90"
                    style={{ background: ACCENT }}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? L('已复制', 'Copied') : L('复制链接', 'Copy link')}
                  </button>
                </div>

                {/* waiting indicator */}
                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-white/45">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {L('等待客户加入… 客户一打开链接,这里会变绿', 'Waiting for your client… this turns green the moment they open the link')}
                </div>

                <button
                  onClick={onDismiss}
                  className="mt-3 w-full rounded-lg py-2 text-xs text-white/40 transition hover:text-white/70"
                >
                  {L('先去看地图(链接随时在左下角)', 'Explore the map first (link stays in the bottom-left)')}
                </button>
              </>
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-4 text-center"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: `${ACCENT}22`, color: ACCENT }}>
                  <Users className="h-6 w-6" />
                </span>
                <div className="mt-3 text-base font-semibold">{L('客户已加入 🎉', 'Client joined 🎉')}</div>
                <p className="mt-1 text-sm text-white/60">{L('开始带他看房吧 —— 你的镜头和点击,他都看得到。', 'Start the tour — they see your camera and every tap.')}</p>
              </motion.div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
