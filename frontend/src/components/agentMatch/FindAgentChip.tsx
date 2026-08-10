/**
 * 项目详情页头部那一排里的「值班经纪」小卡片 —— 和 分享/复制笔记/收藏 并排。
 *
 * owner 2026-08-09:「小卡片放到 project 那个 bar 上」。之前它自己占一整行,
 * 把项目标题挤下去了,而且和页面其余部分不是一个体系。
 *
 * ⚠️ 项目页有 mobile/tablet/desktop **三套各自独立的 header**,这个件要在三处
 *    各引一次。所以 ProjectDetailPage 里把它存成一个变量再三处引用 ——
 *    markup 只有一份,漏改的风险降到最低。
 */
import { useEffect, useState } from 'react'
import { UserRoundSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { peekNextAgent } from '../../lib/agentMatchApi'
import AgentMatchModal from './AgentMatchModal'

export default function FindAgentChip({ projectId, projectName }: { projectId?: string; projectName?: string }) {
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

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        title={t('agentMatch.cta')}
        className="inline-flex items-center gap-1.5 rounded-full border border-teal-300/60 bg-gradient-to-b from-teal-200/90 to-emerald-100/90 px-3 py-1.5 text-xs font-semibold text-teal-800 transition hover:from-teal-200 hover:to-emerald-100 active:scale-95">
        <UserRoundSearch className="h-3.5 w-3.5" />
        {t('agentMatch.dockLabel')}
      </button>
      <AgentMatchModal open={open} onClose={() => setOpen(false)} source="project" projectId={projectId} projectName={projectName} />
    </>
  )
}
