/**
 * 项目详情页头部那一排里的「值班经纪」小卡片 —— 和 分享/复制笔记/收藏 并排。
 *
 * owner 2026-08-09:「小卡片放到 project 那个 bar 上」。之前它自己占一整行,
 * 把项目标题挤下去了,而且和页面其余部分不是一个体系。
 *
 * ⚠️ 项目页有 mobile/tablet/desktop **三套各自独立的 header**,这个件要在三处
 *    各引一次。所以 ProjectDetailPage 里把它存成一个变量再三处引用 ——
 *    markup 只有一份,漏改的风险降到最低。
 *
 * 🔴 **必须用 ui/Button(variant=outline),不许自己写药丸**(owner 2026-08-11:
 *    「这个 button style 不 consistent」)。之前它是 rounded-full + 青绿渐变 + 11px 字,
 *    杵在一排 rounded-md 白底描边按钮中间像是别的网站抠过来的。
 *    现在只保留一点 teal 描边/文字做强调 —— 形状、高度、圆角、字号全部随大流。
 */
import { useEffect, useState } from 'react'
import { UserRoundSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { peekNextAgent } from '../../lib/agentMatchApi'
import AgentMatchModal from './AgentMatchModal'

export default function FindAgentChip({ projectId, projectName, className }: { projectId?: string; projectName?: string; className?: string }) {
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="find-agent"   /* 巡检脚本按它定位 —— 别按中文标签,改名就全瞎 */
        onClick={() => setOpen(true)}
        title={t('agentMatch.cta')}
        className={`border-teal-200 text-teal-700 hover:bg-teal-50 hover:text-teal-800 ${className ?? ''}`}
      >
        <UserRoundSearch className="h-4 w-4 me-1.5" />
        {t('agentMatch.dockLabel')}
      </Button>
      <AgentMatchModal open={open} onClose={() => setOpen(false)} source="project" projectId={projectId} projectName={projectName} />
    </>
  )
}
