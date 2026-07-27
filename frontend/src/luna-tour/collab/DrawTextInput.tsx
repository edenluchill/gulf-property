/**
 * 文字标注的就地输入框 —— 点「T」后在点击处弹出，输入完 ✓ / Enter 落地。
 *
 * 从 CollabDrawToolbar.tsx 搬出来的：那个文件里的右缘竖排 FAB 工具条早在画笔并进
 * 右上工具卡时就没人用了（全站只 import 这一个组件），留着只会和 DrawPalette 双份
 * 维护、迟早漂移。2026-07-27 删掉那份，把还活着的这块拆到这里。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'

export default function DrawTextInput({
  x,
  y,
  onCommit,
  onCancel,
}: {
  x: number
  y: number
  onCommit: (t: string) => void
  onCancel: () => void
}) {
  const [val, setVal] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const { t: tRaw } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  // Focus after mount settles (a mousedown-driven open can otherwise blur us on the
  // trailing mouseup). No blur-to-commit — map/canvas focus churn used to unmount
  // the input the instant it appeared; commit is explicit via ✓ / Enter.
  useEffect(() => { const id = setTimeout(() => ref.current?.focus(), 30); return () => clearTimeout(id) }, [])
  return (
    <div
      className="fixed z-[2200] flex items-center gap-1"
      style={{ left: Math.min(x, window.innerWidth - 260), top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(val)
          else if (e.key === 'Escape') onCancel()
        }}
        placeholder={t('draw.textPlaceholder')}
        maxLength={40}
        className="w-52 rounded-lg border border-teal-400 bg-white/95 px-2.5 py-1.5 text-sm text-slate-900 shadow-xl outline-none backdrop-blur placeholder:text-slate-400"
      />
      <button
        type="button"
        onClick={() => onCommit(val)}
        aria-label={t('draw.confirm')}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 text-white shadow-lg transition hover:bg-teal-600"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label={t('draw.cancel')}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/90 text-slate-500 shadow-lg transition hover:bg-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
