import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Check } from 'lucide-react'
import { normLang } from '../lib/tt'

// 5 语言;code=i18next 用的语言码,short=药丸上的短标。ar 是 RTL(布局 P2,文本先上)。
const LANGS: { key: string; code: string; native: string; short: string }[] = [
  { key: 'en', code: 'en', native: 'English', short: 'EN' },
  { key: 'zh', code: 'zh-CN', native: '中文', short: '中' },
  { key: 'ar', code: 'ar', native: 'العربية', short: 'ع' },
  { key: 'ru', code: 'ru', native: 'Русский', short: 'RU' },
  { key: 'fr', code: 'fr', native: 'Français', short: 'FR' },
]

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cur = normLang(i18n.language)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const active = LANGS.find((l) => l.key === cur) || LANGS[0]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100/80 transition"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Globe className="h-4 w-4" />
        <span>{active.short}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-[1200] mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg" role="listbox">
          {LANGS.map((l) => {
            const isActive = l.key === cur
            return (
              <button
                key={l.key}
                type="button"
                onClick={() => { i18n.changeLanguage(l.code); setOpen(false) }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${isActive ? 'font-semibold text-primary' : 'text-slate-700'}`}
                role="option"
                aria-selected={isActive}
              >
                <span className="w-5 shrink-0 text-center text-xs text-slate-400">{l.short}</span>
                <span className="flex-1">{l.native}</span>
                {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
