import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SourcesPanel } from './SourcesPanel'
import { ProductionsPanel } from './ProductionsPanel'
import { cn } from '@/lib/cn'

type Tab = 'sources' | 'productions'

const TABS: { id: Tab; label: string }[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'productions', label: 'Productions' },
]

export function SetupPage() {
  const [activeTab, setActiveTab] = useState<Tab>('sources')

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Setup"
        subtitle="Configure sources and productions"
      />

      {/* Tabs */}
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

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-5">
        {activeTab === 'sources' && <SourcesPanel />}
        {activeTab === 'productions' && <ProductionsPanel />}
      </div>
    </div>
  )
}
