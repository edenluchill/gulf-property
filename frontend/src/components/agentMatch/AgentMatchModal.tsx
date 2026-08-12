/**
 * 派单面板的外壳 —— 地图药丸和项目页小卡片共用。
 *
 * 抽出来是因为两处的**入口长得不一样、弹出的内容完全一样**。各写一遍的话,
 * 改一处文案/流程就会漏掉另一处(这个功能已经因为"三套 JSX 各写一遍"栽过两次)。
 *
 * 🔴 **是「划出来」的抽屉,不是弹窗**(owner 2026-08-11:「不是很喜欢 popup,
 *    划出来让客户输入,然后点外面就取消这种是否更好?然后手机版显示时感觉有点卡,
 *    能让他划出来吗」)。
 *      手机:从底部升起的 sheet,**可以往下拽着关**(拽把手,不是整片 —— 整片可拖
 *            会和里面的输入/滚动打架);
 *      桌面:从行尾侧滑进来的抽屉(RTL 下自动从左边进,靠 document.dir 判)。
 *
 * 🔴 **别再给遮罩加 backdrop-blur**。这层盖的是一张活着的地图 canvas,
 *    毛玻璃要每帧重新采样底下的内容 —— 手机上那点「卡」就是从这来的。
 *    纯色半透明遮罩 + 只动 transform/opacity,合成器自己就能跑完。
 *
 * 🔴 **必须 portal 到 body**(仓库铁律):祖先里有 transform/backdrop-filter 时,
 *    fixed 会相对那个祖先定位,面板会跑到奇怪的地方。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import FindAgentCard from './FindAgentCard'

/** 手机 = 走底部 sheet;再宽就是侧边抽屉。跟 tailwind 的 sm 断点对齐 */
function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

export default function AgentMatchModal({ open, onClose, source, projectId, projectName }: {
  open: boolean
  onClose: () => void
  source: 'project' | 'map'
  projectId?: string
  /** 预填 WhatsApp 开场白用 —— 让经纪一眼知道买家在看哪个盘 */
  projectName?: string
}) {
  const { t } = useTranslation('misc')
  const isMobile = useIsMobile()
  const drag = useDragControls()

  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    // 抽屉开着时锁掉背后的滚动 —— 不锁的话手机上手指划到边缘会滚底下那一页
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'
  /** 侧边抽屉从哪一侧进来。RTL 下界面整体镜像,抽屉也得跟着从左边进 */
  const offX = rtl ? '-100%' : '100%'
  const spring = { type: 'spring' as const, stiffness: 380, damping: 38, mass: 0.9 }

  const closeBtn = (
    <button type="button" onClick={onClose} aria-label="close"
      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
      <X className="h-4 w-4" />
    </button>
  )

  const head = (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-base font-semibold text-slate-900">{t('agentMatch.cta')}</h3>
      {closeBtn}
    </div>
  )

  /* 打开就直接是「选人 + 留言」—— 候选是**只读**拉的,不落库不占轮换名额,
     所以不需要再让用户点一次"开始"。真正派单发生在他提交那一下。 */
  const body = <FindAgentCard source={source} projectId={projectId} projectName={projectName} compact />

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9000] bg-slate-950/50"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          {isMobile ? (
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={spring}
              /* 只有把手能拖 —— 整片可拖的话,输入框选字、备注框滚动都会被拖走 */
              drag="y" dragListener={false} dragControls={drag}
              dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.4 }}
              onDragEnd={(_, info) => { if (info.offset.y > 110 || info.velocity.y > 600) onClose() }}
              className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-3xl bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
            >
              <div onPointerDown={(e) => drag.start(e)}
                className="-mx-4 flex touch-none cursor-grab justify-center px-4 pb-2 pt-3 active:cursor-grabbing">
                <span className="h-1 w-10 rounded-full bg-slate-300" />
              </div>
              {head}
              {body}
            </motion.div>
          ) : (
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ x: offX }} animate={{ x: 0 }} exit={{ x: offX }}
              transition={spring}
              className="absolute inset-y-0 end-0 flex w-[26rem] max-w-[92vw] flex-col overflow-y-auto rounded-s-3xl bg-white p-5 shadow-2xl"
            >
              {/* 关闭钉在角上,内容整体垂直居中 —— 表单只有半屏高,顶部对齐会在下面
                  留一大片空白,看着像没加载完。m-auto 在内容超高时会自动退让给滚动。 */}
              <div className="absolute end-4 top-4 z-10">{closeBtn}</div>
              <div className="m-auto w-full py-8">
                <h3 className="mb-3 pe-8 text-base font-semibold text-slate-900">{t('agentMatch.cta')}</h3>
                {body}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
