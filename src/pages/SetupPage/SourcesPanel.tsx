import { useState } from 'react'
import { useSourcesStore } from '@/store/sources.store'
import type { StreamType } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { Modal } from '@/components/ui/Modal'

function timeSince(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

const STREAM_TYPE_LABELS: Record<StreamType, string> = {
  srt: 'SRT',
  whip: 'WHIP',
}

export function SourcesPanel() {
  const { sources, isLoading, lastFetchedAt, removeSource, addSource } = useSourcesStore()
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newStreamType, setNewStreamType] = useState<StreamType>('srt')

  function handleAdd() {
    if (!newName.trim()) return
    addSource({ name: newName.trim(), address: newAddress.trim(), streamType: newStreamType, status: 'inactive', color: '#27272a' })
    setNewName('')
    setNewAddress('')
    setNewStreamType('srt')
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
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[--color-text-primary] truncate">{src.name}</span>
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted] uppercase">
                  {STREAM_TYPE_LABELS[src.streamType]}
                </span>
              </div>
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
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Stream Type</label>
            <div className="flex gap-2">
              {(['srt', 'whip'] as StreamType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNewStreamType(t)}
                  className={`flex-1 py-2 rounded text-sm font-mono uppercase transition-colors ${
                    newStreamType === t
                      ? 'bg-[--color-accent] text-white'
                      : 'bg-[--color-surface-raised] border border-[--color-border-strong] text-[--color-text-muted] hover:text-[--color-text-primary]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Address</label>
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder={newStreamType === 'srt' ? 'srt://192.168.1.10:9000' : 'https://ingest.example.com/whip/token'}
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
