/**
 * 「客户」tab —— C 端买家/访客,合并原「访客明细」+「流失」两 tab。
 * 左侧分区:全部客户(访客明细 + 热 Leads)/ 流失(高意向但沉默的可挽回客户)。
 */
import { useState } from 'react'
import { Users, UserMinus } from 'lucide-react'
import Visitors from './Visitors'
import LostCustomers from './LostCustomers'
import LeadTable from './LeadTable'
import type { Lead } from '../../lib/analyticsApi'

type Section = 'all' | 'lost'

export default function Customers({ days, leads }: { days: number; leads: Lead[] }) {
  const [section, setSection] = useState<Section>('all')
  const items: { id: Section; label: string; Icon: typeof Users }[] = [
    { id: 'all', label: '全部客户', Icon: Users },
    { id: 'lost', label: '流失客户', Icon: UserMinus },
  ]
  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <aside className="shrink-0 md:w-44">
        <nav className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((it) => {
            const active = section === it.id
            return (
              <button key={it.id} onClick={() => setSection(it.id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-teal-50 text-teal-700' : 'text-slate-600 hover:bg-slate-100/80'
                }`}>
                <it.Icon className="h-4 w-4" />
                <span className="whitespace-nowrap">{it.label}</span>
              </button>
            )
          })}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 space-y-5">
        {section === 'all' ? (
          <>
            <Visitors days={days} />
            <LeadTable leads={leads} />
          </>
        ) : (
          <LostCustomers days={days} />
        )}
      </div>
    </div>
  )
}
