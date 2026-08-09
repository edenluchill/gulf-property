/**
 * 派单弹窗的外壳 —— 地图药丸和项目页小卡片共用。
 *
 * 抽出来是因为两处的**入口长得不一样、弹出的内容完全一样**。各写一遍的话,
 * 改一处文案/流程就会漏掉另一处(这个功能今天已经因为"三套 JSX 各写一遍"栽过两次)。
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import FindAgentCard from './FindAgentCard'

export default function AgentMatchModal({ open, onClose, source, projectId, projectName }: {
  open: boolean
  onClose: () => void
  source: 'project' | 'map'
  projectId?: string
  /** 预填 WhatsApp 开场白用 —— 让经纪一眼知道买家在看哪个盘 */
  projectName?: string
}) {
  const { t } = useTranslation('misc')

  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, onClose])

  if (!open) return null

  // 铁律:transform/backdrop-filter 祖先里的 fixed modal 必须 portal 到 body
  return createPortal(
    <div className="fixed inset-0 z-[9000] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{t('agentMatch.cta')}</h3>
          <button type="button" onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* autoStart:用户点入口那一下就是「我要找经纪」,不该再点第二次。
            不违反「点了才派单」—— 这个组件只有点开弹窗才挂载。 */}
        <FindAgentCard source={source} projectId={projectId} projectName={projectName} autoStart compact />
      </div>
    </div>,
    document.body,
  )
}
