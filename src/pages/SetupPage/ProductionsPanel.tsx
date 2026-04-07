import { useState } from 'react'
import { useProductionsStore } from '@/store/productions.store'
import { useProductionStore } from '@/store/production.store'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { Modal } from '@/components/ui/Modal'

export function ProductionsPanel() {
  const { productions, isLoading, addProduction, removeProduction, updateStatus } = useProductionsStore()
  const { activeProductionId, setActiveProduction } = useProductionStore()
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')

  async function handleAdd() {
    if (!newName.trim()) return
    await addProduction(newName.trim())
    setNewName('')
    setAddOpen(false)
  }

  async function handleDelete(id: string) {
    await removeProduction(id)
    if (activeProductionId === id) setActiveProduction(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[--color-text-muted] font-mono">
            {productions.length} productions
          </span>
          {isLoading && <span className="text-xs text-[--color-accent]">Refreshing…</span>}
        </div>
        <Button size="sm" variant="active" onClick={() => setAddOpen(true)}>+ New Production</Button>
      </div>

      <div className="flex flex-col gap-2">
        {productions.map((prod) => {
          const isActive = prod.status === 'active'
          return (
            <div
              key={prod.id}
              className={`flex items-center gap-3 px-4 py-3 rounded border transition-colors ${
                isActive
                  ? 'bg-[--color-surface-3] border-[--color-accent]'
                  : 'bg-[--color-surface-3] border-[--color-border] hover:border-zinc-600'
              }`}
            >
              <StatusDot color={isActive ? 'red' : 'gray'} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-[--color-text-primary] truncate block">{prod.name}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={isActive ? 'ghost' : 'pvw'}
                  onClick={() => {
                    void updateStatus(prod.id, isActive ? 'inactive' : 'active')
                    setActiveProduction(isActive ? null : prod.id)
                  }}
                >
                  {isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(prod.id)} className="opacity-40 hover:opacity-100">✕</Button>
              </div>
            </div>
          )
        })}
      </div>

      <Modal open={addOpen} title="New Production" onClose={() => setAddOpen(false)}>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Production Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
              placeholder="Evening News — May 1"
              className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="active" onClick={() => void handleAdd()} disabled={!newName.trim()}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
