import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SourcesPanel } from './SourcesPanel'
import { GraphicsPanel } from './GraphicsPanel'
import { OutputsPanel } from './OutputsPanel'
import { GatewaysPanel } from './GatewaysPanel'
import { cn } from '@/lib/cn'

type Tab = 'sources' | 'gateways' | 'graphics' | 'outputs'

const TABS: { id: Tab; label: string }[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'gateways', label: 'Gateways' },
  { id: 'graphics', label: 'Graphics' },
  { id: 'outputs', label: 'Outputs' },
]

export function SetupPage() {
  const [activeTab, setActiveTab] = useState<Tab>('sources')

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="I/O"
        subtitle="Configure sources, graphics, and outputs"
      />

      {/* Tabs */}
      <div className="flex border-b border-[--color-border] px-5 pt-2 gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer',
              activeTab === tab.id
                ? 'border-[--color-accent] text-[--color-text-primary]'
                : 'border-transparent text-[--color-text-muted] hover:text-orange-500',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-5">
        {activeTab === 'sources' && <SourcesPanel />}
        {activeTab === 'gateways' && <GatewaysPanel />}
        {activeTab === 'graphics' && <GraphicsPanel />}
        {activeTab === 'outputs' && <OutputsPanel />}
      </div>
    </div>
  )
}
