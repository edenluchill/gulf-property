/**
 * 项目详情页上的**导览入口**。
 *
 * 为什么它值得占一整条:owner 的观察是「客户看项目肯定不知道怎么看」—— 详情页有八个
 * tab、几十个数字,一个第一次买迪拜房的人不知道该先看哪个。这条导览回答的正是他真正
 * 想问但问不出口的那句:**「这地方到底在哪、周围有什么？」**
 *
 * 数据侧的理由:最近 30 天 211 个外部访客看了 442 次项目详情页,而经纪版 tour 被外部
 * 客户播放了 **0 次**。导览是好资产,只是一直摆在没人经过的地方。这条按钮就是把它
 * 搬到人流上。
 *
 * ISOLATION:没有导览就渲染 null(53 个盘会一个一个铺开,「暂时没有」是常态,
 * 不该在页面上留一个禁用的按钮或者报错)。删掉这个文件 + 详情页里那一行即可移除。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Play, Sparkles } from 'lucide-react'
import { fetchProjectTour, tourDurationLabel, tourWatchUrl, type ProjectTour } from '../projectTours'
import { trackEvent } from '../../lib/track'

export default function ProjectTourCta({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation(['lunaTour'])
  const [tour, setTour] = useState<ProjectTour | null>(null)

  useEffect(() => {
    let alive = true
    setTour(null)
    if (!projectId) return
    fetchProjectTour(projectId).then((x) => {
      if (alive) setTour(x)
    })
    return () => {
      alive = false
    }
  }, [projectId])

  if (!tour) return null

  const dur = tourDurationLabel(tour.duration_ms, i18n.language || 'en')

  return (
    <div className="border-b border-teal-100 bg-gradient-to-r from-teal-50 via-emerald-50 to-white">
      <div className="container mx-auto px-4">
        <Link
          to={tourWatchUrl(tour.share_code)}
          onClick={() =>
            // 入口点击率是这个实验的第一个数字:有多少人愿意点「带我看一遍」。
            trackEvent('tour_entry_click', { project_id: tour.project_id, share_code: tour.share_code })
          }
          className="group flex items-center gap-3 py-3 sm:gap-4"
        >
          {/* 播放键 —— 一眼看出这是「会动的东西」,不是又一个 tab */}
          <span className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-teal-600 text-white shadow-md shadow-teal-600/25 transition-transform group-hover:scale-105 sm:h-12 sm:w-12">
            <Play className="h-5 w-5 translate-x-[1px] fill-current rtl:-scale-x-100" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[15px] font-bold text-slate-900 sm:text-base">
                {t('lunaTour:projectTours.ctaTitle')}
              </span>
              {dur && (
                <span
                  translate="no"
                  className="flex-shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 ring-1 ring-teal-200"
                >
                  {dur}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-600 sm:text-[13px]">
              <Sparkles className="h-3 w-3 flex-shrink-0 text-teal-600" />
              <span className="truncate">{t('lunaTour:projectTours.ctaSub')}</span>
            </span>
          </span>

          <span className="flex-shrink-0 rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors group-hover:bg-teal-700 sm:px-4 sm:text-sm">
            {t('lunaTour:projectTours.ctaGo')}
          </span>
        </Link>
      </div>
    </div>
  )
}
