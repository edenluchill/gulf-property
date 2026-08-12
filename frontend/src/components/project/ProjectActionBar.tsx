/**
 * 项目页头部那一排操作 —— **一个玻璃胶囊里的分段控件**,不是四个各自带边框的方盒子。
 *
 * owner 2026-08-11:「style 不好看,想 consistent 的情况能现代化高级一点,
 * 不过也要显得专业且有好的 animation」。
 *
 * 🔴 **手机 / pad / 桌面三套 header 共用这一个件**。这一页已经因为「三套 JSX 各写一遍」
 *    栽过两次(漏改一处 → 只有某个断点是旧样子)。三档的差别只有一个 `compact`:
 *    手机上后三颗收成纯图标,「找顾问」永远留字 —— 它是唯一带来生意的那颗。
 *
 * 动效原则(别越做越花):
 *   · 整排进场:一次 opacity+y,300ms 就结束,不循环;
 *   · 每颗:hover 抬 1px、按下缩到 0.94,spring 收尾 —— 手感来自这里,不是来自颜色;
 *   · 只有**状态变化**才做显式动画(复制→打勾、收藏→心跳),因为那是要给反馈的时刻;
 *   · 唯一常驻的动画是「找顾问」上那颗在线点,2.4s 一次,慢到不抢注意力。
 */
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, Heart, Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import FindAgentChip from '../agentMatch/FindAgentChip'
import { ACTION_BAR, ACTION_MOTION, actionItem } from './actionBarStyles'

interface Props {
  projectId?: string
  projectName?: string
  /** 手机档:分享/复制/收藏 收成纯图标 */
  compact?: boolean
  copied: boolean
  isFav: boolean
  onShare: () => void
  onCopyNotes: () => void
  onToggleFavorite: () => void
  className?: string
}

export default function ProjectActionBar({
  projectId, projectName, compact, copied, isFav,
  onShare, onCopyNotes, onToggleFavorite, className,
}: Props) {
  const { t } = useTranslation(['project'])

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={`${ACTION_BAR} ${className ?? ''}`}
    >
      {/* ⚠️ 分隔线由 FindAgentChip 自己带出来,不写在这里 —— 池子空时它整个渲染
          null,写在这里就会剩一道孤零零的竖线杵在胶囊开头。 */}
      <FindAgentChip projectId={projectId} projectName={projectName} />

      {/* 分享 */}
      <motion.button
        type="button"
        onClick={onShare}
        title={t('project:share', 'Share')}
        aria-label={t('project:share', 'Share')}
        {...ACTION_MOTION}
        className={actionItem({ compact })}
      >
        <Share2 className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
        {!compact && t('project:share', 'Share')}
      </motion.button>

      {/* 复制笔记 —— 复制成功那一下是这排唯一需要「说话」的反馈,给它一个真动画 */}
      <motion.button
        type="button"
        onClick={onCopyNotes}
        title={t('project:copyNotes.button')}
        aria-label={t('project:copyNotes.button')}
        {...ACTION_MOTION}
        className={actionItem({ compact })}
      >
        <span className="relative flex h-4 w-4 items-center justify-center">
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="done"
                initial={{ scale: 0.4, opacity: 0, rotate: -25 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                className="absolute"
              >
                <Check className="h-4 w-4 text-emerald-600" />
              </motion.span>
            ) : (
              <motion.span
                key="idle"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute transition-transform duration-200 group-hover:scale-110"
              >
                <Copy className="h-4 w-4" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        {!compact && (
          <span className={copied ? 'text-emerald-600' : undefined}>
            {copied ? t('project:copyNotes.copied') : t('project:copyNotes.button')}
          </span>
        )}
      </motion.button>

      {/* 收藏 —— 心跳一下 + 一圈扩散,点完立刻知道存上了 */}
      <motion.button
        type="button"
        onClick={onToggleFavorite}
        title={isFav ? t('project:saved', 'Saved') : t('project:save', 'Save')}
        aria-label={isFav ? t('project:saved', 'Saved') : t('project:save', 'Save')}
        aria-pressed={isFav}
        {...ACTION_MOTION}
        className={actionItem({ compact, tone: isFav ? 'rose' : 'slate' })}
      >
        <span className="relative flex h-4 w-4 items-center justify-center">
          {isFav && (
            <motion.span
              key="burst"
              initial={{ scale: 0.6, opacity: 0.45 }}
              animate={{ scale: 2.2, opacity: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="absolute inset-0 rounded-full bg-rose-400"
            />
          )}
          <motion.span
            key={isFav ? 'on' : 'off'}
            animate={isFav ? { scale: [1, 1.35, 0.95, 1] } : { scale: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="relative"
          >
            <Heart className={`h-4 w-4 transition-transform duration-200 ${isFav ? 'fill-current' : 'group-hover:scale-110'}`} />
          </motion.span>
        </span>
        {!compact && (isFav ? t('project:saved', 'Saved') : t('project:save', 'Save'))}
      </motion.button>
    </motion.div>
  )
}
