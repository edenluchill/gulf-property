/**
 * 健康度面板 —— 「我们现在到底健不健康，接下来该干什么」。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 owner 的原话：「是数据 但是该怎么做决策？感觉光看这个看不出」。**他是对的。**
 *
 * 第一版是一屏数字，看完不产生任何决策。所以现在的结构是倒过来的：
 *
 *   1. 【判断层】最上面，占最大视觉权重 —— 每条带「触发它的数字」+「具体到人的下一步」
 *   2. 下面才是支撑这些判断的原始数据
 *
 * 判断规则写在**服务端**（healthQueries.ts 的 buildSignals），不在这里 ——
 * 那样才能被测试、被版本化、在 code review 里争论。前端只负责把它画出来。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 图形选择（遵循 dataviz 规范）：
 * · 头条数字 → stat tile，不画成单根柱子
 * · 产出→被消费 → **meter**（同色系轨道，填充=被消费，轨道=产出）。
 *   ⚠️ 这里**故意不用同一根坐标轴的并列条形**：实时带看 351 vs Luna Tour 0，
 *      同轴之下小的那些会直接消失。而真正要读的是**行内比例**，meter 正好表达这个。
 * · 地图 DAU → 单序列面积图（单序列不需要图例，标题已经说明它是什么）+ hover
 * · 漏斗 → meter + 灰色参考线，**不做红绿灯**（见下）
 *
 * 🔴 比率一律带分母 n，n < MIN_SAMPLE 显示「样本不足」而不是假精度百分比。
 *    n=1~3 时再来一个用户比率就翻倍，那不是信号是噪音。
 *    benchmark 只画灰线：现阶段所有比率长期不会好看，做成红绿灯 = 天天全红 =
 *    一周内变成墙纸。**判断层才是报警的地方**，它有具体依据和具体动作。
 */
import { useEffect, useState } from 'react'
import { AlertCircle, AlertOctagon, AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Info } from 'lucide-react'
import { fetchHealth, HealthSnapshot, HealthFeature, HealthFunnel, HealthSignal, HealthMap } from '../../lib/analyticsApi'
import StatCard from './StatCard'

/** 分母低于这个数就不显示百分比 —— 再算下去只是给自己制造精确的幻觉。 */
const MIN_SAMPLE = 20

/**
 * 状态色（dataviz 规范的固定 status palette，不参与主题）。
 * ⚠️ **状态色永远不单独承载含义** —— 每条都必须配 icon + 文字标签。
 */
const SEVERITY = {
  critical: { hex: '#d03b3b', Icon: AlertOctagon, label: '立刻处理', bg: 'bg-red-50',    ring: 'ring-red-200' },
  serious:  { hex: '#ec835a', Icon: AlertTriangle, label: '需要决断', bg: 'bg-orange-50', ring: 'ring-orange-200' },
  warning:  { hex: '#fab219', Icon: AlertCircle,   label: '注意',     bg: 'bg-amber-50',  ring: 'ring-amber-200' },
  info:     { hex: '#0ca30c', Icon: Info,          label: '机会',     bg: 'bg-emerald-50', ring: 'ring-emerald-200' },
} as const

function SignalCard({ s }: { s: HealthSignal }) {
  const cfg = SEVERITY[s.severity]
  const { Icon } = cfg
  return (
    <div className={`rounded-xl ${cfg.bg} p-3.5 ring-1 ${cfg.ring}`}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: cfg.hex }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-slate-900">{s.title}</span>
            {/* 文字标签 —— 状态绝不靠颜色单独表达 */}
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset"
              style={{ color: cfg.hex, borderColor: cfg.hex }}>
              {cfg.label}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-600">
            <span className="text-slate-400">依据 </span>{s.evidence}
          </div>
          <div className="mt-1.5 text-sm leading-relaxed text-slate-800">{s.action}</div>
        </div>
      </div>
    </div>
  )
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return <span className="text-slate-300">—</span>
  const d = cur - prev
  if (d === 0) return <span className="inline-flex items-center gap-0.5 text-slate-400"><ArrowRight className="h-3 w-3" />持平</span>
  const up = d > 0
  return (
    <span className={`inline-flex items-center gap-0.5 ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {up ? '+' : ''}{d}<span className="ml-0.5 text-slate-400">(上期 {prev})</span>
    </span>
  )
}

/**
 * 产出 → 被消费，用 meter 表达。
 * 轨道 = 产出（经纪做了多少），填充 = 被消费（客户真的看了多少）。
 * 空轨道 = 做了但没人看；轨道本身为 0 = 压根没人做。两种含义完全不同，必须能分辨。
 */
function FeatureMeter({ f }: { f: HealthFeature }) {
  const nothingMade = f.produced === 0
  const nothingSeen = f.produced > 0 && f.consumed === 0
  const pct = f.produced > 0 ? (f.consumed / f.produced) * 100 : 0

  return (
    <div className="border-t border-slate-100 py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-800">{f.label}</span>
          {!f.canSplitInternal && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">含内部测试</span>
          )}
        </div>
        <div className="text-sm tabular-nums text-slate-500">
          {nothingMade ? (
            <span className="font-medium text-slate-400">无人使用</span>
          ) : (
            <>
              <span className="font-semibold text-slate-900">{f.consumed}</span>
              <span> / {f.produced} 被客户打开</span>
              <span className="ml-1.5 text-slate-400">({Math.round(pct)}%)</span>
            </>
          )}
        </div>
      </div>

      {/* meter：同色系单一色相，轨道浅、填充深 */}
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
        {!nothingMade && (
          <div className="h-full rounded-full transition-all"
            style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, background: nothingSeen ? '#ec835a' : '#2563eb' }} />
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-slate-500">产出环比 <Delta cur={f.produced} prev={f.producedPrev} /></span>
        {f.consumedDetail && !nothingMade && <span className="text-slate-500">{f.consumedDetail}</span>}
      </div>

      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">口径</summary>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{f.note}</p>
      </details>
    </div>
  )
}

/** 地图 DAU 面积图。单序列 → 不需要图例；带 hover 十字线 + tooltip。 */
function MapTrend({ daily }: { daily: HealthMap['daily'] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!daily.length) return null

  const W = 720, H = 120, PAD = 8
  const max = Math.max(...daily.map((d) => d.dau), 1)
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(daily.length - 1, 1)
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2)

  const line = daily.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.dau)}`).join(' ')
  const area = `${line} L${x(daily.length - 1)},${H - PAD} L${x(0)},${H - PAD} Z`
  const h = hover !== null ? daily[hover] : null

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const rel = ((e.clientX - r.left) / r.width) * W
          const i = Math.round(((rel - PAD) / (W - PAD * 2)) * (daily.length - 1))
          setHover(Math.max(0, Math.min(daily.length - 1, i)))
        }}>
        <defs>
          <linearGradient id="pz-map-dau" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#pz-map-dau)" />
        <path d={line} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" />
        {h && (
          <>
            <line x1={x(hover!)} y1={PAD} x2={x(hover!)} y2={H - PAD} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" />
            {/* 标记外圈用表面色描边，避免和面积叠在一起糊掉 */}
            <circle cx={x(hover!)} cy={y(h.dau)} r={5} fill="#2563eb" stroke="#fff" strokeWidth={2} />
          </>
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-slate-400">
        <span>{daily[0].date.slice(5)}</span>
        <span className="tabular-nums">
          {h ? `${h.date.slice(5)} · ${h.dau} 人 · ${h.areas} 次区域详情` : `近 14 天 · 峰值 ${max} 人/天`}
        </span>
        <span>{daily[daily.length - 1].date.slice(5)}</span>
      </div>
    </div>
  )
}

/** 比率 + 市场参考线。**刻意全灰**，报警交给判断层。 */
function FunnelRow({ f }: { f: HealthFunnel }) {
  const tooSmall = f.n < MIN_SAMPLE || f.value === null
  const scale = Math.max(f.good, f.value ?? 0) * 1.15
  const pos = (v: number) => `${Math.min(100, (v / scale) * 100)}%`

  return (
    <div className="border-t border-slate-100 py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-slate-700">{f.label}</span>
        <div className="text-sm tabular-nums">
          {tooSmall
            ? <span className="text-slate-400">样本不足（n={f.n}）</span>
            : <><span className="font-semibold text-slate-900">{f.value}%</span>
                <span className="ml-1 text-xs text-slate-400">n={f.n}</span></>}
        </div>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-slate-100">
        {f.value !== null && (
          <div className="absolute inset-y-0 left-0 rounded-full bg-slate-700" style={{ width: pos(f.value) }} />
        )}
        <div className="absolute inset-y-[-3px] w-px bg-slate-400" style={{ left: pos(f.median) }} />
        <div className="absolute inset-y-[-3px] w-px bg-slate-300" style={{ left: pos(f.good) }} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
        <span>市场中位 {f.median}%</span><span>优秀 {f.good}%</span>
        <span className="text-slate-300">· {f.source}</span>
      </div>
    </div>
  )
}

const Panel = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
  <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
    <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
    {sub && <p className="mb-1 mt-0.5 text-xs leading-relaxed text-slate-500">{sub}</p>}
    {children}
  </section>
)

export default function Health({ days = 30 }: { days?: number }) {
  const [data, setData] = useState<HealthSnapshot | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    setData(null); setErr(null)
    fetchHealth(days)
      .then((d) => { if (!stale) setData(d) })
      .catch((e) => { if (!stale) setErr(String(e?.message || e)) })
    return () => { stale = true }
  }, [days])

  if (err) return <div className="p-6 text-sm text-rose-600">加载失败：{err}</div>
  if (!data) return <div className="p-6 text-sm text-slate-400">加载中…</div>

  const { agents: a, map, audience: c } = data

  return (
    <div className="space-y-6">
      {/* ── 判断层：面板存在的理由，占最大视觉权重 ── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          现在最该处理的
          <span className="ml-2 text-xs font-normal text-slate-400">
            按严重度排序 · 每条都带触发它的数字
          </span>
        </h3>
        {data.signals.length === 0 ? (
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
            没有触发任何规则。规则见 <code>healthQueries.ts</code> 的 <code>buildSignals</code>。
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {data.signals.map((s, i) => <SignalCard key={i} s={s} />)}
          </div>
        )}
      </section>

      {/* ── C 端受众 ──
          🔴 v2 漏了这一整块,导致面板把「2 个经纪做出过产出物」显示成
             「你仅有的 2 个真实激活用户」。owner 当场反驳「不是有很多客户在用功能吗」——
             他是对的。C 端排在 B 端**前面**:它人数多一个量级,而且唯一付费的客户也在这条线上。 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          C 端：买家 / 访客
          <span className="ml-2 text-xs font-normal text-slate-400">
            用地图和 Luna 语音的人 · 已排除内部
          </span>
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="访客总数" value={c.visitors} />
          <StatCard label="用过核心功能" value={c.usedCore} hint="地图 / 项目 / 搜索" />
          <StatCard label="用了 ≥5 次" value={c.engaged} />
          <StatCard label="回访过" value={c.returned} hint={`≥3 天的有 ${c.deep} 人`} />
          <StatCard label="Luna 语音用户" value={c.lunaUsers} />
          <StatCard label="真实多轮对话" value={c.lunaConvos} hint="≥2 轮，排掉点开就关" />
        </div>
      </section>

      {/* ── B 端经纪侧 ── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          B 端：注册经纪
          <span className="ml-2 text-xs font-normal text-slate-400">
            用 tour / 报价单 / 报告 的人 · 已排除 owner / 合伙人 / demo
          </span>
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="注册总数" value={a.total} />
          <StatCard label={`近 ${days} 天新注册`} value={a.newCur} hint={a.newPrev > 0 ? `上期 ${a.newPrev}` : undefined} />
          <StatCard label="开了试用" value={a.trialStarted} />
          <StatCard label="做出过可分享产出物" value={a.activated} hint="tour / 报价单 / 报告，任一即算" />
          <StatCard label="注册日之后回来过" value={a.returned} hint={`≥3 天活动的有 ${a.deepUsers} 人`} />
          <StatCard label="真实付费" value={a.paying} hint="不含 owner 自己" />
        </div>
      </section>

      {/* ── 地图：全站唯一有真实重复使用的功能 ── */}
      <Panel
        title="地图使用"
        sub="关键不是「多少人用过」而是「用过的人第二天还回来吗」——广度发个链接就有，习惯难得。">
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label={`${days} 天用过区域详情`} value={map.users} hint={`共 ${map.events} 次`} />
          <StatCard label="用了 ≥5 次" value={map.engaged} hint="当场认真在用" />
          <StatCard label="第二天还回来" value={map.multiday}
            hint={map.users > 0 ? `占 ${Math.round((map.multiday / map.users) * 100)}%` : undefined} />
          <StatCard label="撞到免费额度墙" value={map.gateHit} hint="付费闸门的触达量" />
        </div>
        <MapTrend daily={map.daily} />
      </Panel>

      {/* ── 产出 → 被消费 ── */}
      <Panel
        title="产出 → 被客户消费"
        sub="生成了 ≠ 有价值。经纪做了东西却没发给客户、或发了客户没打开，说明他自己都不信这东西值得发——这比留存率更早暴露功能没被认可。">
        {data.features.map((f) => <FeatureMeter key={f.key} f={f} />)}
      </Panel>

      {/* ── 漏斗 ── */}
      <Panel
        title="漏斗 vs 市场基准"
        sub="参考线是灰色的，不是红绿灯：现阶段样本量下这些比率长期不会好看，做成告警只会让你停止看这个面板。要报警的东西都在最上面的判断层。">
        {data.funnel.map((f) => <FunnelRow key={f.key} f={f} />)}
      </Panel>

      {/* ── 口径透明 ── */}
      <details className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600">
          被算作「自己人」而排除的账号（{data.internalAgents.length}）
        </summary>
        <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
          {data.internalAgents.map((e) => <li key={e}>{e}</li>)}
        </ul>
        <p className="mt-2 leading-relaxed">
          写死在 <code>backend/src/services/healthQueries.ts</code> 的 <code>INTERNAL_AGENTS</code>。
          往里加人 = 让某个「客户」从所有统计里消失，必须确认过才能加。
        </p>
      </details>
    </div>
  )
}
