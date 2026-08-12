/**
 * 「找顾问」—— 项目页头部那一排里的第一颗,也能在区域弹窗里单独站着。
 *
 * owner 2026-08-09:「小卡片放到 project 那个 bar 上」。之前它自己占一整行,
 * 把项目标题挤下去了,而且和页面其余部分不是一个体系。
 *
 * 🔴 **样式只来自 project/actionBarStyles,不许自己写一套**
 *    (owner 2026-08-11:「这个 button style 不 consistent」→ 再一次:
 *    「style 不好看,想 consistent 的情况能现代化高级一点」)。
 *    历史:rounded-full 青绿渐变药丸 → outline Button → 现在的玻璃分段控件。
 *    每次它自己长一套样式,就和旁边三颗打架一次。
 *
 * 🟢 **绿点是有意义的,不是装饰**:这个件只在 peek 到池子里真有人时才渲染,
 *    所以那颗点等于「现在真的有人能接」。别在池子空的时候画点。
 *
 * ⚠️ 项目页有 mobile/tablet/desktop **三套各自独立的 header**。现在三套都走
 *    ProjectActionBar,这个件只被它引一次 —— 别再往 header 里单独塞。
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { UserRoundSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { peekNextAgent } from '../../lib/agentMatchApi'
import { ACTION_BAR, ACTION_DIVIDER, ACTION_MOTION, actionItem } from '../project/actionBarStyles'
import AgentMatchModal from './AgentMatchModal'

export default function FindAgentChip({
  projectId, projectName, standalone,
}: {
  projectId?: string
  projectName?: string
  /** true = 不在 ProjectActionBar 里(区域弹窗),自己套一层玻璃胶囊 */
  standalone?: boolean
}) {
  const { t } = useTranslation('misc')
  /** 只判断池子里有没有人 —— **按钮上不显示是谁**(像 Uber,点开才知道)。 */
  const [hasPool, setHasPool] = useState(false)
  const [open, setOpen] = useState(false)

  // 只读 peek,不落库 —— 每个打开页面的人都会渲染这个件,用会写库的接口
  // 会把轮换名额全消耗在压根没想找经纪的人身上。
  useEffect(() => {
    let alive = true
    peekNextAgent(projectId).then((a) => { if (alive) setHasPool(!!a) })
    return () => { alive = false }
  }, [projectId])

  // 池子空就不渲染 —— 摆一个点了说「暂时没有经纪」的按钮比没有按钮更伤
  if (!hasPool) return null

  const btn = (
    <motion.button
      type="button"
      data-testid="find-agent"   /* 巡检脚本按它定位 —— 别按中文标签,改名就全瞎 */
      onClick={() => setOpen(true)}
      title={t('agentMatch.cta')}
      {...ACTION_MOTION}
      className={actionItem({ tone: 'teal' })}
    >
      <UserRoundSearch className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
      {t('agentMatch.dockLabel')}
      {/* 「现在真的有人在」—— 一颗实心点 + 一圈 2.4s 慢扩散的光晕。
          不用 animate-ping:那个 1s 一下,在一排静态按钮里太吵。 */}
      <span className="relative ms-0.5 flex h-1.5 w-1.5">
        <motion.span
          className="absolute inset-0 rounded-full bg-emerald-400"
          animate={{ scale: [1, 2.4, 2.4], opacity: [0.5, 0, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
        />
        <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
    </motion.button>
  )

  return (
    <>
      {standalone ? (
        <span className={ACTION_BAR}>{btn}</span>
      ) : (
        <>
          {btn}
          {/* 分隔线跟着这颗一起出现/消失 —— 放在 ProjectActionBar 里的话,
              池子空(本件返回 null)时会剩一道孤零零的竖线杵在胶囊开头。 */}
          <span className={ACTION_DIVIDER} aria-hidden />
        </>
      )}
      <AgentMatchModal open={open} onClose={() => setOpen(false)} source="project" projectId={projectId} projectName={projectName} />
    </>
  )
}
