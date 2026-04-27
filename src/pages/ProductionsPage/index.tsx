import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ProductionsPanel } from '@/pages/SetupPage/ProductionsPanel'
import { ConfigsPanel } from '@/pages/SetupPage/ConfigsPanel'
import { cn } from '@/lib/cn'

type Tab = 'productions' | 'configs'

const TABS: { id: Tab; label: string }[] = [
  { id: 'productions', label: 'Productions' },
  { id: 'configs', label: 'Configs' },
]

export function ProductionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('productions')

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Productions"
        subtitle="Manage productions and configurations"
      />

      <div className="flex border-b border-[--color-border] px-5 pt-2 gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.id
                ? 'border-[--color-accent] text-[--color-text-primary]'
                : 'border-transparent text-[--color-text-muted] hover:text-[--color-text-primary]',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-5">
        {activeTab === 'productions' && <ProductionsPanel />}
        {activeTab === 'configs' && <ConfigsPanel />}
      </div>
    </div>
  )
}
