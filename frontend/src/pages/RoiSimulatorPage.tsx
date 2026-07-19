/**
 * /roi —— 房产投资收益蒙特卡洛模拟器。
 *
 * 和对手(m37 remc)的差别只有一条,但是决定性的:**对手六个输入全靠用户瞎填,
 * 我们能用真实数据填三项**(总价 / 物业费 / 区域租金回报),剩下三项诚实标成假设。
 * 所以这一页最重要的不是四张图,是每个数字旁边那颗徽章。
 *
 * ⚠️ 房价涨幅默认给保守值 3%,**不是**本区历史值 —— 我们只有 2021–2025,而那正是
 *    迪拜史上最猛的后疫情暴涨段,直接外推会朝着「让客户下单」的方向系统性高估。
 *    历史值放在一个要主动点的按钮后面,旁边挂繁荣期警示。别把它改成默认。
 *    见 docs/map-timeline-and-roi-calculator-spec.md §③ / [[luna-tour-audit-2026-07-12]]。
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet-async'
import { SlidersHorizontal, X, Info, TrendingUp, Loader2 } from 'lucide-react'
import MoneyInput from '../components/MoneyInput'
import DirhamSymbol from '../components/DirhamSymbol'
import SourceBadge from '../components/roi/SourceBadge'
import ProjectUnitPicker from '../components/roi/ProjectUnitPicker'
import HistogramChart from '../components/roi/charts/HistogramChart'
import CdfChart from '../components/roi/charts/CdfChart'
import HoldChart from '../components/roi/charts/HoldChart'
import ScatterCanvas from '../components/roi/charts/ScatterCanvas'
import { Sheet, SheetContent } from '../components/ui/sheet'
import { useSimulation } from '../lib/roi/useSimulation'
import { betaFromMean, PERCENTILE_POINTS, type SimParams } from '../lib/roi/simulate'
import {
  fetchRoiPriors,
  resolveMaintenance,
  CONSERVATIVE_GROWTH_PCT,
  DEFAULT_GROWTH_SD_PCT,
  DEFAULT_VACANCY_MEAN_PCT,
  FALLBACK_MAINTENANCE_PCT,
  type RoiProject,
  type RoiPriors,
  type SourceKind,
  type MaintenanceOrigin,
} from '../lib/roi/priors'
import { formatMoneyCompact } from '../lib/money'
import { cn } from '../lib/utils'

const RUNS = 10000

/** 滑块行 —— 模块级定义,避免每次渲染重建组件类型导致输入失焦。 */
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  badge,
  hint,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  badge?: React.ReactNode
  hint?: string
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-600">
          <span className="truncate">{label}</span>
          {badge}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        // h-6 而不是默认的细条:手指在手机上要抓得住
        className="mt-1.5 h-6 w-full cursor-pointer accent-teal-600"
      />
      {hint && <p className="-mt-0.5 text-[11px] leading-snug text-slate-400">{hint}</p>}
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'plain' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11px] leading-tight text-slate-500">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums sm:text-2xl',
          tone === 'good' ? 'text-teal-600' : tone === 'bad' ? 'text-rose-600' : 'text-slate-900'
        )}
      >
        {value}
      </div>
    </div>
  )
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {subtitle && <p className="mb-2 mt-0.5 text-[11px] leading-snug text-slate-500">{subtitle}</p>}
      {children}
    </section>
  )
}

export default function RoiSimulatorPage() {
  const { t, i18n } = useTranslation('roi')
  const [params, setParams] = useSearchParams()
  const lang = i18n.language

  /**
   * 深链参数在**挂载时冻住**。直接读 `params.get('project')` 会被下面的 URL 同步
   * effect 在首帧清成 null,把还在飞的预加载请求作废 —— 深链就静默失效了
   * (从项目详情页「模拟这套的收益」点进来永远是空白表单)。
   * bootstrapped:预加载有结果之前,一个字都不许改 URL。
   */
  const [initialProjectId] = useState(() => params.get('project'))
  const [project, setProject] = useState<RoiProject | null>(null)
  const [unitId, setUnitId] = useState<string | null>(() => params.get('unit'))
  const [bootstrapped, setBootstrapped] = useState(!initialProjectId)
  const [priors, setPriors] = useState<RoiPriors | null>(null)
  const [loadingPriors, setLoadingPriors] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)

  // ── 输入 ──────────────────────────────────────────────────────────────────
  const [priceRaw, setPriceRaw] = useState('1500000')
  const [downPct, setDownPct] = useState(25)
  const [ratePct, setRatePct] = useState(4.5)
  const [loanYears, setLoanYears] = useState(25)
  const [holdYears, setHoldYears] = useState(7)
  const [growthMeanPct, setGrowthMeanPct] = useState(CONSERVATIVE_GROWTH_PCT)
  const [growthSdPct, setGrowthSdPct] = useState(DEFAULT_GROWTH_SD_PCT)
  const [yieldModePct, setYieldModePct] = useState(6)
  const [vacancyMeanPct, setVacancyMeanPct] = useState(DEFAULT_VACANCY_MEAN_PCT)
  const [maintenancePct, setMaintenancePct] = useState(FALLBACK_MAINTENANCE_PCT)

  /**
   * 自动带出的真实值。徽章 = 「当前值还等于自动带出的那个数吗」——
   * 用户一改就自动变成 ⚪ 假设,不需要额外的 dirty 标记,也不会说谎。
   * growth 只有在用户主动点了「用历史值」之后才有值。
   */
  const [auto, setAuto] = useState<{ price: number | null; maintenance: number | null; yieldPct: number | null; growth: number | null }>({
    price: null,
    maintenance: null,
    yieldPct: null,
    growth: null,
  })
  const srcOf = (key: keyof typeof auto, current: number): SourceKind =>
    auto[key] != null && Math.abs(current - (auto[key] as number)) < 1e-9 ? 'dld' : 'assumption'

  const unit = useMemo(
    () => project?.units.find((u) => u.id === unitId) || null,
    [project, unitId]
  )

  // 选中项目 → 默认选第一个有标价的户型(没有标价的户型对这页毫无用处)
  useEffect(() => {
    if (!project) return
    if (unitId && project.units.some((u) => u.id === unitId)) return
    const first = project.units.find((u) => u.price != null) || project.units[0]
    setUnitId(first ? first.id : null)
  }, [project, unitId])

  // 户型 → 总价(实测)
  useEffect(() => {
    if (!unit) return
    if (unit.price != null) setPriceRaw(String(Math.round(unit.price)))
    setAuto((a) => ({ ...a, price: unit.price != null ? Math.round(unit.price) : null }))
  }, [unit])

  /**
   * 维护费率:项目级 → 片区 DLD → 假设。片区物业费要等 priors 回来,所以这个
   * effect 依赖 priors,不能和总价那个合并(合并会在 priors 到达前先落到 1.5%
   * 假设值,然后跳一下 —— 用户会看到徽章从 ⚪ 闪成 🔵)。
   */
  const maintenance = useMemo(
    () =>
      resolveMaintenance(
        project?.serviceChargePerSqft ?? null,
        priors?.areaServiceChargePerSqft ?? null,
        unit?.area ?? null,
        unit?.price ?? null
      ),
    [project, priors, unit]
  )
  const [maintenanceOrigin, setMaintenanceOrigin] = useState<MaintenanceOrigin>('assumption')
  useEffect(() => {
    setMaintenancePct(maintenance.pct)
    setMaintenanceOrigin(maintenance.origin)
    setAuto((a) => ({ ...a, maintenance: maintenance.origin === 'assumption' ? null : maintenance.pct }))
  }, [maintenance])

  // 项目 → 区域先验(回报走 DLD;涨幅只取回来备用,**不自动填**)
  useEffect(() => {
    if (!project) {
      setPriors(null)
      setAuto((a) => ({ ...a, yieldPct: null, growth: null }))
      return
    }
    let alive = true
    setLoadingPriors(true)
    fetchRoiPriors(project.id, project.area)
      .then((p) => {
        if (!alive) return
        setPriors(p)
        if (p.yieldPct != null) {
          setYieldModePct(Number(p.yieldPct.toFixed(2)))
          setAuto((a) => ({ ...a, yieldPct: Number(p.yieldPct!.toFixed(2)) }))
        }
      })
      .finally(() => alive && setLoadingPriors(false))
    return () => {
      alive = false
    }
  }, [project])

  // URL 深链保持同步(可分享:/roi?project=..&unit=..)
  useEffect(() => {
    if (!bootstrapped) return
    const next = new URLSearchParams(params)
    if (project) next.set('project', project.id)
    else next.delete('project')
    if (unitId) next.set('unit', unitId)
    else next.delete('unit')
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, unitId, bootstrapped])

  const price = Number(priceRaw) || 0

  const simParams: SimParams | null = useMemo(() => {
    if (price <= 0) return null
    const band = 0.25 // 租金回报三角分布的相对带宽(mode ±25%)
    const { alpha, beta } = betaFromMean(vacancyMeanPct)
    return {
      price,
      downPct,
      ratePct,
      loanYears,
      holdYears,
      growthMeanPct,
      growthSdPct,
      yieldMinPct: Math.max(0, yieldModePct * (1 - band)),
      yieldModePct,
      yieldMaxPct: yieldModePct * (1 + band),
      vacancyAlpha: alpha,
      vacancyBeta: beta,
      maintenancePct,
      runs: RUNS,
      seed: 20260719,
    }
  }, [price, downPct, ratePct, loanYears, holdYears, growthMeanPct, growthSdPct, yieldModePct, vacancyMeanPct, maintenancePct])

  const { result, running } = useSimulation(simParams)

  const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`
  const yieldBand = `${(yieldModePct * 0.75).toFixed(1)}% – ${(yieldModePct * 1.25).toFixed(1)}%`

  const useHistoricalGrowth = () => {
    if (priors?.historicalGrowthPct == null) return
    const v = Number(priors.historicalGrowthPct.toFixed(1))
    setGrowthMeanPct(v)
    setAuto((a) => ({ ...a, growth: v }))
  }

  const yieldDetail = priors?.areaName
    ? t('detail.yield', {
        area: priors.areaName,
        count: priors.rentCount ?? 0,
        through: priors.dataThrough ?? '—',
      })
    : undefined
  // 两个分支都写成静态 t('…') —— 拼出来的 key 逃得过 i18n-key-check 的正则,
  // 而裸键 i18next 不报错、会直接吐到界面上。
  const maintenanceArgs = {
    rate: maintenance.perSqft ?? 0,
    area: Math.round(unit?.area ?? 0).toLocaleString('en-US'),
    areaName: priors?.areaName ?? project?.area ?? '',
  }
  const maintenanceDetail =
    maintenance.perSqft == null || unit?.area == null
      ? undefined
      : maintenanceOrigin === 'project'
        ? t('detail.maintenance', maintenanceArgs)
        : t('detail.maintenanceArea', maintenanceArgs)

  // ── 参数面板(桌面侧栏与手机抽屉共用同一段 JSX)──────────────────────────
  const paramsPanel = (
    <div className="space-y-5">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">{t('section.property')}</h2>
        <ProjectUnitPicker
          project={project}
          selectedUnitId={unitId}
          onProjectSelect={setProject}
          onUnitSelect={setUnitId}
          autoLoadProjectId={initialProjectId}
          onAutoLoadSettled={() => setBootstrapped(true)}
        />
      </div>

      <div className="space-y-3.5 border-t border-slate-100 pt-4">
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <label htmlFor="roi-price" className="text-xs font-medium text-slate-600">
              {t('field.price')}
            </label>
            <SourceBadge source={srcOf('price', price)} detail={project?.name} />
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100">
            <DirhamSymbol className="text-slate-400" />
            <MoneyInput
              value={priceRaw}
              onChange={setPriceRaw}
              placeholder="1,500,000"
              className="w-full bg-transparent py-2 text-sm outline-none"
            />
          </div>
        </div>

        <SliderRow label={t('field.downPct')} value={downPct} min={10} max={100} step={5} suffix="%" onChange={setDownPct} badge={<SourceBadge source="assumption" />} />
        <SliderRow label={t('field.ratePct')} value={ratePct} min={0} max={12} step={0.1} suffix="%" onChange={setRatePct} badge={<SourceBadge source="assumption" />} />
        <SliderRow label={t('field.loanYears')} value={loanYears} min={1} max={30} step={1} suffix={t('unit.years')} onChange={setLoanYears} />
        <SliderRow label={t('field.holdYears')} value={holdYears} min={1} max={20} step={1} suffix={t('unit.years')} onChange={setHoldYears} />
      </div>

      <div className="space-y-3.5 border-t border-slate-100 pt-4">
        <h2 className="text-sm font-semibold text-slate-900">{t('section.market')}</h2>

        <SliderRow
          label={t('field.yieldPct')}
          value={yieldModePct}
          min={0}
          max={15}
          step={0.1}
          suffix="%"
          onChange={setYieldModePct}
          badge={<SourceBadge source={srcOf('yieldPct', yieldModePct)} detail={yieldDetail} />}
          hint={t('field.yieldBand', { band: yieldBand })}
        />

        <div>
          <SliderRow
            label={t('field.growthMeanPct')}
            value={growthMeanPct}
            min={-10}
            max={20}
            step={0.5}
            suffix="%"
            onChange={setGrowthMeanPct}
            badge={<SourceBadge source={srcOf('growth', growthMeanPct)} />}
          />
          {/* 历史值必须是「主动点」才用,且旁边永远挂繁荣期警示 —— 这条不能省 */}
          {priors?.historicalGrowthPct != null && (
            <div className="mt-1 rounded-lg bg-amber-50 px-2.5 py-2 ring-1 ring-amber-100">
              <button
                type="button"
                onClick={useHistoricalGrowth}
                className="text-xs font-medium text-amber-800 underline decoration-amber-300 underline-offset-2 hover:text-amber-900"
              >
                {t('growth.useHistorical', { value: priors.historicalGrowthPct.toFixed(1) })}
              </button>
              <p className="mt-1 text-[11px] leading-snug text-amber-700">{t('growth.boomWarning')}</p>
            </div>
          )}
        </div>

        <SliderRow label={t('field.growthSdPct')} value={growthSdPct} min={0} max={25} step={0.5} suffix="%" onChange={setGrowthSdPct} badge={<SourceBadge source="assumption" />} hint={t('field.growthSdHint')} />

        <SliderRow
          label={t('field.vacancyPct')}
          value={vacancyMeanPct}
          min={0}
          max={40}
          step={1}
          suffix="%"
          onChange={setVacancyMeanPct}
          badge={<SourceBadge source="assumption" />}
          hint={t('field.vacancyHint')}
        />

        <SliderRow
          label={t('field.maintenancePct')}
          value={maintenancePct}
          min={0}
          max={8}
          step={0.05}
          suffix="%"
          onChange={setMaintenancePct}
          badge={<SourceBadge source={srcOf('maintenance', maintenancePct)} detail={maintenanceDetail} />}
          hint={maintenanceDetail}
        />
      </div>
    </div>
  )

  return (
    <div className="relative flex-1 overflow-y-auto bg-slate-50">
      <Helmet>
        <title>{t('seo.title')}</title>
        <meta name="description" content={t('seo.description')} />
      </Helmet>

      <div className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-5 lg:px-6 lg:pb-10 lg:pt-8">
        <header className="mb-5">
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{t('title')}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">{t('subtitle')}</p>
        </header>

        {/* ⚠️ 两栏在 xl(1280) 才展开,不是 lg(1024)。这页挂在经纪台里,左边**已经有一条
            侧栏**了 —— lg 断点看的是视口不是容器,1024px 视口下内容区只剩 ~780px,
            360px 参数栏一占,四张图挤在 420px 里没法看。 */}
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)] xl:gap-6">
          {/* 桌面:常驻侧栏。手机/iPad 竖屏:走底部抽屉(见页尾) */}
          <aside className="hidden xl:block">
            <div className="sticky top-4 rounded-xl border border-slate-200 bg-white p-4">{paramsPanel}</div>
          </aside>

          <div className="min-w-0 space-y-4">
            {/* 当前假设摘要 —— 手机上看不到侧栏,这行必须交代清楚在算什么 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600">
              <span className="font-medium text-slate-900">
                <DirhamSymbol /> {formatMoneyCompact(price, lang)}
              </span>
              <span>{t('summary.down', { pct: downPct })}</span>
              <span>{t('summary.rate', { pct: ratePct })}</span>
              <span>{t('summary.hold', { years: holdYears })}</span>
              {project && <span className="truncate text-teal-700">{project.name}</span>}
              {loadingPriors && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
            </div>

            {!result ? (
              <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-sm text-slate-400">
                {price <= 0 ? t('empty.needPrice') : t('empty.computing')}
              </div>
            ) : (
              <>
                <div className={cn('grid grid-cols-2 gap-2.5 sm:grid-cols-4', running && 'opacity-60')}>
                  <StatCard label={t('stat.medianIrr')} value={pct(result.median)} tone="good" />
                  <StatCard label={t('stat.pLoss')} value={pct(result.pLoss)} tone={result.pLoss > 0.2 ? 'bad' : 'plain'} />
                  <StatCard label={t('stat.pAbove10')} value={pct(result.pAbove10)} />
                  <StatCard label={t('stat.sd')} value={pct(result.sd)} />
                </div>

                <ChartCard title={t('chart.hist.title')} subtitle={t('chart.hist.sub', { runs: RUNS.toLocaleString('en-US') })}>
                  <HistogramChart bins={result.hist} median={result.median} />
                </ChartCard>

                <ChartCard title={t('chart.percentiles.title')} subtitle={t('chart.percentiles.sub')}>
                  <div className="-mx-1 overflow-x-auto">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead>
                        <tr className="text-[11px] text-slate-500">
                          {PERCENTILE_POINTS.map((p) => (
                            <th key={p} className="px-1 pb-1 font-medium">
                              P{p}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {PERCENTILE_POINTS.map((p) => (
                            <td
                              key={p}
                              className={cn(
                                'px-1 py-1 text-center font-semibold tabular-nums',
                                result.percentiles[p] < 0 ? 'text-rose-600' : 'text-slate-900',
                                p === 50 && 'bg-slate-50'
                              )}
                            >
                              {pct(result.percentiles[p])}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </ChartCard>

                <ChartCard title={t('chart.cdf.title')} subtitle={t('chart.cdf.sub')}>
                  <CdfChart points={result.cdf} threshold={0} />
                </ChartCard>

                <ChartCard title={t('chart.hold.title')} subtitle={t('chart.hold.sub')}>
                  <HoldChart points={result.hold} activeYears={holdYears} />
                </ChartCard>

                <ChartCard title={t('chart.scatter.title')} subtitle={t('chart.scatter.sub')}>
                  <ScatterCanvas points={result.scatter} />
                </ChartCard>
              </>
            )}

            {/* 诚实声明 —— 不是免责套话,是这一页存在的理由。别删。 */}
            <section className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Info className="h-4 w-4 text-slate-400" />
                {t('honesty.title')}
              </h3>
              <dl className="mt-2.5 space-y-2.5 text-xs leading-relaxed text-slate-600">
                <div>
                  <dt className="flex items-center gap-1.5 font-medium text-slate-800">
                    <SourceBadge source="dld" />
                    {t('honesty.dldTitle')}
                  </dt>
                  <dd className="mt-0.5">{t('honesty.dldBody')}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 font-medium text-slate-800">
                    <SourceBadge source="assumption" />
                    {t('honesty.assumptionTitle')}
                  </dt>
                  <dd className="mt-0.5">{t('honesty.assumptionBody')}</dd>
                </div>
                <div>
                  <dt className="font-medium text-amber-800">{t('honesty.vacancyTitle')}</dt>
                  <dd className="mt-0.5">{t('honesty.vacancyBody')}</dd>
                </div>
                <div>
                  <dt className="font-medium text-amber-800">{t('honesty.growthTitle')}</dt>
                  <dd className="mt-0.5">{t('honesty.growthBody')}</dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      </div>

      {/* 手机 / iPad 竖屏:参数走底部抽屉。左右两栏硬塞进 414px 是不可用的 */}
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-lg xl:hidden"
      >
        <SlidersHorizontal className="h-4 w-4" />
        {t('mobile.adjust')}
      </button>

      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="bottom" className="h-[86vh] max-h-[86vh] rounded-t-2xl p-0">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <TrendingUp className="h-4 w-4 text-teal-600" />
              {t('mobile.panelTitle')}
            </h2>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label={t('mobile.close')}
              className="-me-2 rounded-full p-2 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* flex-1 + min-h-0 —— SheetContent 是 flex-col,不给 min-h-0 内层不会滚 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-10">{paramsPanel}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
