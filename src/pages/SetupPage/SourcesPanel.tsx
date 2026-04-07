import { useState } from 'react'
import { useSourcesStore } from '@/store/sources.store'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { Modal } from '@/components/ui/Modal'

function timeSince(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

export function SourcesPanel() {
  const { sources, isLoading, lastFetchedAt, removeSource, addSource } = useSourcesStore()
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')

  function handleAdd() {
    if (!newName.trim()) return
    addSource({ name: newName.trim(), address: newAddress.trim(), status: 'inactive', color: '#27272a' })
    setNewName('')
    setNewAddress('')
    setAddOpen(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[--color-text-muted] font-mono">
            {sources.length} sources · refreshed {timeSince(lastFetchedAt)}
          </span>
          {isLoading && <span className="text-xs text-[--color-accent]">Refreshing…</span>}
        </div>
        <Button size="sm" variant="active" onClick={() => setAddOpen(true)}>+ Add Source</Button>
      </div>

      <div className="flex flex-col gap-1">
        {sources.map((src) => (
          <div
            key={src.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded bg-[--color-surface-3] border border-[--color-border] hover:border-zinc-600 transition-colors"
          >
            <StatusDot color={src.status === 'active' ? 'red' : 'gray'} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-[--color-text-primary] truncate block">{src.name}</span>
              <span className="text-xs text-[--color-text-muted] font-mono truncate block">{src.address}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => removeSource(src.id)} className="opacity-40 hover:opacity-100">✕</Button>
          </div>
        ))}
      </div>

      <Modal open={addOpen} title="Add Source" onClose={() => setAddOpen(false)}>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Camera 4 — Closeup"
              className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
            />
          </div>
          <div>
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Address</label>
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="srt://192.168.1.10:9000"
              className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="active" onClick={handleAdd} disabled={!newName.trim()}>Add Source</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
