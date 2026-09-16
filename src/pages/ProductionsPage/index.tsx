import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { ProductionsPanel } from '@/pages/SetupPage/ProductionsPanel'
import { ConfigsPanel } from '@/pages/SetupPage/ConfigsPanel'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { useProductionStore } from '@/store/production.store'

type Tab = 'productions' | 'configs'

const TABS: { id: Tab; label: string }[] = [
  { id: 'productions', label: 'Productions' },
  { id: 'configs', label: 'Configs' },
]

export function ProductionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('productions')
  const deactivatedExternally = useProductionStore((s) => s.deactivatedExternally)
  const deactivationReason = useProductionStore((s) => s.deactivationReason)
  const setDeactivatedExternally = useProductionStore((s) => s.setDeactivatedExternally)

  // Attribute the deactivation to what actually happened (#130): an idle
  // auto-timeout must not be reported as another user deactivating it.
  const isIdle = deactivationReason === 'idle'
  const deactivatedTitle = isIdle ? 'Production went idle' : 'Production deactivated'
  const deactivatedMessage = isIdle
    ? 'This production was automatically deactivated after being idle. Reactivate it to continue.'
    : 'This production was deactivated by another user.'

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

      <div className="flex-1 overflow-auto p-5">
        {activeTab === 'productions' && <ProductionsPanel />}
        {activeTab === 'configs' && <ConfigsPanel />}
      </div>

      {deactivatedExternally && (
        <Modal open title={deactivatedTitle} onClose={() => setDeactivatedExternally(false)} className="max-w-sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[--color-text-primary]">
              {deactivatedMessage}
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setDeactivatedExternally(false)}>OK</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
