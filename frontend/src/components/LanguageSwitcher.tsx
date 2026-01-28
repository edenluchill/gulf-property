import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { Button } from './ui/button'

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()

  const toggle = () => {
    const next = i18n.language?.startsWith('zh') ? 'en' : 'zh-CN'
    i18n.changeLanguage(next)
  }

  const label = i18n.language?.startsWith('zh') ?  '中' : 'EN'

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100/80"
    >
      <Globe className="h-4 w-4" />
      <span>{label}</span>
    </Button>
  )
}
