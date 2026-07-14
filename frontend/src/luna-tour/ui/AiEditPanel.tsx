/**
 * 💬 跟 Luna 说你想改什么 —— **编辑器的主界面**。
 *
 * ── 为什么推翻时间线(owner 实测)────────────────────────────────────────
 * 「而且感觉这个编辑器有点难用啊」「客户已经来看到直接懵逼了 完全不会用」
 *
 * 根因不是那个时间线做得不好,是**我们在让经纪当剪辑师** —— 而他是**销售**。
 * 轨道、卡片时长、镜头风格滑块,这是给视频剪辑师设计的心智模型。
 * 经纪脑子里的东西是:「结尾太长了」「别提那个学校」「多讲讲海景」——
 * **他不该去找哪个滑块对应这句话。他应该直接说这句话。**
 *
 * 所以主界面就是一个输入框。时间线收进「高级」。
 *
 * ── ⚠️ 卡片上的数字**不能改**,而且这是刻意的 ──────────────────────────
 * ROI 卡的 335 万、房源卡的价格、邻居对比的成交量,**全部来自真实 DLD 数据**。
 * 这个项目最贵的一课就是「AI 编造数字」(那次是 73% 的假涨幅,还被当事实播报)。
 * overlay 被设计成**一个数字都不带**,就是为了让任何人 —— 包括模型、包括经纪 ——
 * 都无法伪造。
 *
 * **能手改 = 能伪造 = 客户凭什么信我们说的是真的。**
 * 所以这不是「缺失的功能」,是**产品的地基**。经纪能控制的只有:要不要显示、什么时候出现。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Sparkles, Undo2, Wand2 } from 'lucide-react'
import { lunaFetch } from '../lunaApi'

interface Diff {
  beat_id: string
  kind: string
  before: string
  after: string
}

const KIND_ZH: Record<string, string> = {
  intro: '开场', arrival: '到达', life: '生活', homes: '户型',
  arbitrage: '对比邻区', weakness: '短板', numbers: '数字', outro: '结尾',
}

/** 经纪嘴里真正会说的话 —— 点一下就填进去，不用想怎么措辞。 */
const PRESETS_ZH = [
  '整体短一点，太啰嗦了',
  '说得更像人话，别念稿',
  '多强调租金回报',
  '去掉空洞的形容词和套话',
  '结尾直接一点，别绕',
]
const PRESETS_EN = [
  'Shorter overall — it rambles',
  'Sound like a person, not a script',
  'Emphasise rental yield more',
  'Cut the empty adjectives',
  'Make the ending direct',
]

export default function AiEditPanel({
  sessionId,
  onChanged,
}: {
  sessionId: string
  onChanged?: () => void
}) {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)

  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [diffs, setDiffs] = useState<Diff[]>([])
  const [msg, setMsg] = useState('')
  const [canUndo, setCanUndo] = useState(false)

  const apply = async (instruction: string) => {
    if (!instruction.trim() || busy) return
    setBusy(true)
    setMsg('')
    setDiffs([])
    try {
      const r = await lunaFetch(`/sessions/${sessionId}/ai-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      })
      const d = await r.json()
      if (!r.ok) {
        setMsg(`❌ ${d.error || L('改稿失败', 'Edit failed')}`)
      } else if (!d.applied) {
        setMsg(d.message || L('Luna 没找到要改的地方 —— 换个说法再试?', 'Luna found nothing to change — try rephrasing.'))
      } else {
        setDiffs(d.diffs || [])
        setCanUndo(true)
        setText('')
        onChanged?.()
      }
    } catch {
      setMsg(L('网络错误', 'Network error'))
    }
    setBusy(false)
  }

  const undo = async () => {
    setBusy(true)
    try {
      await lunaFetch(`/sessions/${sessionId}/undo`, { method: 'POST' })
      setDiffs([])
      setCanUndo(false)
      setMsg(L('✅ 已撤销', '✅ Reverted'))
      onChanged?.()
    } catch {
      setMsg(L('撤销失败', 'Undo failed'))
    }
    setBusy(false)
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-500" />
        <span className="font-semibold">{L('告诉 Luna 你想改什么', 'Tell Luna what to change')}</span>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        {L('用大白话说就行 —— 她自己会找到该改的那几段。（数字来自真实成交数据，不会被改动。）',
           'Just say it plainly — she finds the right beats herself. (Numbers come from real transaction data and are never changed.)')}
      </p>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void apply(text) }}
          disabled={busy}
          placeholder={L('例：结尾太长了，砍一半；别提那个学校', 'e.g. The ending is too long — halve it. Drop the school.')}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        <button
          onClick={() => void apply(text)}
          disabled={busy || !text.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {busy ? L('改稿中…', 'Editing…') : L('改', 'Apply')}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {(zh ? PRESETS_ZH : PRESETS_EN).map((p) => (
          <button
            key={p}
            disabled={busy}
            onClick={() => void apply(p)}
            className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-200 disabled:opacity-40"
          >
            {p}
          </button>
        ))}
      </div>

      {msg && <p className="mt-3 text-sm text-slate-500">{msg}</p>}

      {/* 前后对照 —— 经纪必须看得见 AI 到底动了什么,不能是个黑盒 */}
      {diffs.length > 0 && (
        <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-800">
              {L(`Luna 改了 ${diffs.length} 处`, `Luna changed ${diffs.length}`)}
            </span>
            {canUndo && (
              <button
                onClick={() => void undo()}
                disabled={busy}
                className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                <Undo2 className="h-3.5 w-3.5" /> {L('撤销', 'Undo')}
              </button>
            )}
          </div>
          <div className="space-y-3">
            {diffs.map((d) => (
              <div key={d.beat_id} className="text-xs leading-relaxed">
                <div className="mb-1 font-semibold text-slate-500">
                  {zh ? KIND_ZH[d.kind] || d.kind : d.kind}
                </div>
                <p className="text-slate-400 line-through decoration-rose-300">{d.before}</p>
                <p className="mt-1 font-medium text-slate-800">{d.after}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
