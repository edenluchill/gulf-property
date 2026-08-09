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
import { useTranslation } from 'react-i18next'
import { peekNextAgent, type MatchedAgent } from '../../lib/agentMatchApi'
import { AgentAvatar } from './FindAgentCard'
import AgentMatchModal from './AgentMatchModal'

export default function FindAgentChip({ projectId }: { projectId?: string }) {
  const { t } = useTranslation('misc')
  const [onDuty, setOnDuty] = useState<(MatchedAgent & { id: string }) | null>(null)
  const [open, setOpen] = useState(false)

  // 只读 peek,不落库 —— 每个打开页面的人都会渲染这个件,用会写库的接口
  // 会把轮换名额全消耗在压根没想找经纪的人身上。
  useEffect(() => {
    let alive = true
    peekNextAgent(projectId).then((a) => { if (alive) setOnDuty(a) })
    return () => { alive = false }
  }, [projectId])

  // 池子空就不渲染 —— 摆一个点了说「暂时没有经纪」的按钮比没有按钮更伤
  if (!onDuty) return null

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        title={`${onDuty.display_name || ''} · ${t('agentMatch.askHim')}`}
        className="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pe-3 ps-1 transition hover:border-slate-300 hover:bg-slate-50 active:scale-95">
        <span className="relative shrink-0">
          <AgentAvatar agent={onDuty} size={9} />
          {/* 绿点 = 现在有人在接;它说明的是「有人值班」,不是「已认证」 */}
          <span className="absolute -end-0.5 -bottom-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
        </span>
        <span className="min-w-0 text-start">
          <span className="block max-w-[9rem] truncate text-xs font-semibold leading-tight text-slate-900">
            {onDuty.display_name}
          </span>
          <span className="block text-[10px] leading-tight text-emerald-600">{t('agentMatch.askHim')}</span>
        </span>
      </button>
      <AgentMatchModal open={open} onClose={() => setOpen(false)} source="project" projectId={projectId} />
    </>
  )
}
