import { useState, useEffect } from 'react'
import { useSourcesStore } from '@/store/sources.store'
import { useProductionsStore } from '@/store/productions.store'
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
  srt: 'MPEG-TS/SRT',
  efp: 'EFP/SRT',
  whip: 'WHIP',
  test1: 'Pinwheel',
  test2: 'Colors',
  html: 'HTML',
}

const STREAM_TYPE_HAS_ADDRESS: Record<StreamType, boolean> = {
  srt: true,
  efp: true,
  whip: false,
  test1: false,
  test2: false,
  html: true,
}

const STREAM_TYPE_HAS_LATENCY: Record<StreamType, boolean> = {
  srt: true,
  efp: true,
  whip: false,
  test1: false,
  test2: false,
  html: false,
}

const STREAM_TYPE_ADDRESS_PLACEHOLDER: Partial<Record<StreamType, string>> = {
  html: 'https://example.com/overlay',
}

const CREATABLE_STREAM_TYPES: StreamType[] = ['srt', 'efp', 'html']

export function SourcesPanel() {
  const { sources, isLoading, lastFetchedAt, removeSource, addSource, updateSource, fetchAll } = useSourcesStore()
  const productions = useProductionsStore((s) => s.productions)

  useEffect(() => {
    void fetchAll()
    const id = setInterval(() => void fetchAll(), 15000)
    return () => clearInterval(id)
  }, [fetchAll])
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; address: string; latency: string; streamType: StreamType } | null>(null)
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newStreamType, setNewStreamType] = useState<StreamType>('srt')
  const [newLatency, setNewLatency] = useState('')
  const [addAddressError, setAddAddressError] = useState<string | null>(null)
  const [editAddressError, setEditAddressError] = useState<string | null>(null)

  // Source IDs currently assigned to an active or activating production
  const activeSourceIds = new Set(
    productions
      .filter((p) => p.status === 'active' || p.status === 'activating')
      .flatMap((p) => p.sources.map((s) => s.sourceId)),
  )

  function validateAddress(address: string, streamType: StreamType): string | null {
    if (!STREAM_TYPE_HAS_ADDRESS[streamType]) return null
    if (!address.trim()) return 'Address is required'
    if (streamType === 'html') {
      try { const u = new URL(address); if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error() }
      catch { return 'Must be a valid http:// or https:// URL' }
    } else {
      if (!/^srt:\/\/[^?#]*:\d+/.test(address.trim())) return 'Must be a valid srt:// URI'
    }
    return null
  }

  function handleAdd() {
    if (!newName.trim()) return
    const addrErr = validateAddress(newAddress, newStreamType)
    if (addrErr) { setAddAddressError(addrErr); return }
    addSource({
      name: newName.trim(),
      address: newAddress.trim(),
      streamType: newStreamType,
      status: 'inactive',
      color: '#27272a',
      ...(STREAM_TYPE_HAS_LATENCY[newStreamType] ? { latency: parseInt(newLatency, 10) || 125 } : {}),
    })
    setNewName('')
    setNewAddress('')
    setNewStreamType('srt')
    setNewLatency('')
    setAddAddressError(null)
    setAddOpen(false)
  }

  function handleEdit() {
    if (!editTarget || !editTarget.name.trim()) return
    const addrErr = validateAddress(editTarget.address, editTarget.streamType)
    if (addrErr) { setEditAddressError(addrErr); return }
    void updateSource(editTarget.id, {
      name: editTarget.name.trim(),
      address: editTarget.address.trim(),
      latency: parseInt(editTarget.latency, 10) || 125,
    })
    setEditAddressError(null)
    setEditTarget(null)
  }

  const deleteTarget = deleteTargetId ? sources.find((s) => s.id === deleteTargetId) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[--color-text-muted] font-mono">
            {sources.length} sources · refreshed {timeSince(lastFetchedAt)}
          </span>
          {isLoading && <span className="text-xs text-[--color-accent]">Refreshing…</span>}
        </div>
        <Button size="sm" variant="active" onClick={() => setAddOpen(true)}>+ New Source</Button>
      </div>

      <div className="flex flex-col gap-1">
        {[...sources].sort((a, b) => a.name.localeCompare(b.name)).map((src) => {
          const inActiveProduction = activeSourceIds.has(src.id)
          return (
            <div
              key={src.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded bg-[--color-surface-3] border transition-colors ${
                inActiveProduction
                  ? 'border-[--color-border] hover:border-zinc-600 cursor-not-allowed'
                  : 'border-[--color-border] hover:border-orange-500 cursor-pointer'
              }`}
              onClick={() => !inActiveProduction && setEditTarget({ id: src.id, name: src.name, address: src.address ?? '', latency: src.latency != null ? String(src.latency) : '', streamType: src.streamType })}
            >
              <StatusDot color={inActiveProduction ? 'red' : 'gray'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[--color-text-primary] truncate">{src.name}</span>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted] uppercase">
                    {STREAM_TYPE_LABELS[src.streamType]}
                  </span>
                </div>
                {STREAM_TYPE_HAS_ADDRESS[src.streamType] && (
                  <span className="text-xs text-[--color-text-muted] font-mono truncate block">
                    {src.address}
                    {src.latency != null && src.latency !== 125 && (
                      <span className="ml-2 text-[--color-text-muted] opacity-60">{src.latency} ms</span>
                    )}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); !inActiveProduction && setEditTarget({ id: src.id, name: src.name, address: src.address ?? '', latency: src.latency != null ? String(src.latency) : '', streamType: src.streamType }) }}
                disabled={inActiveProduction}
                className="text-white hover:text-orange-500 disabled:opacity-30 disabled:cursor-not-allowed"
                title={inActiveProduction ? 'Cannot edit source in an active production' : 'Edit source'}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); setDeleteTargetId(src.id) }}
                disabled={inActiveProduction}
                className="text-white hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                title={inActiveProduction ? 'Cannot delete source in an active production' : 'Delete source'}
              >
                Delete
              </Button>
            </div>
          )
        })}
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <Modal open title="Delete Source" onClose={() => setDeleteTargetId(null)} className="max-w-sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[--color-text-primary]">
              Delete <span className="font-semibold">{deleteTarget.name}</span>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteTargetId(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  void removeSource(deleteTarget.id)
                  setDeleteTargetId(null)
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit modal */}
      {editTarget && (
        <Modal open title="Edit Source" onClose={() => { setEditTarget(null); setEditAddressError(null) }}>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Name</label>
              <input
                type="text"
                value={editTarget.name}
                onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })}
                className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30"
              />
            </div>
            {STREAM_TYPE_HAS_ADDRESS[editTarget.streamType] && (
              <div>
                <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Address</label>
                <input
                  type="text"
                  value={editTarget.address}
                  onChange={(e) => { setEditTarget({ ...editTarget, address: e.target.value }); setEditAddressError(null) }}
                  className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30"
                />
                {editAddressError && <p className="text-xs text-red-400 mt-1">{editAddressError}</p>}
              </div>
            )}
            {STREAM_TYPE_HAS_LATENCY[editTarget.streamType] && (
              <div>
                <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Latency (ms)</label>
                <input
                  type="number"
                  min={0}
                  value={editTarget.latency}
                  placeholder="125"
                  onChange={(e) => setEditTarget({ ...editTarget, latency: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30"
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => { setEditTarget(null); setEditAddressError(null) }}>Cancel</Button>
              <Button variant="active" onClick={handleEdit} disabled={!editTarget.name.trim()}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      <Modal open={addOpen} title="New Source" onClose={() => setAddOpen(false)}>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Camera 4 — Closeup"
              className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30"
            />
          </div>
          <div>
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Stream Type</label>
            <div className="grid grid-cols-2 gap-2">
              {CREATABLE_STREAM_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setNewStreamType(t); setNewAddress('') }}
                  className={`py-2 rounded text-sm border transition-colors ${
                    newStreamType === t
                      ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-surface-2)] border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-orange-500'
                  }`}
                >
                  {STREAM_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          {STREAM_TYPE_HAS_ADDRESS[newStreamType] && (
            <div>
              <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Address</label>
              <input
                type="text"
                value={newAddress}
                onChange={(e) => { setNewAddress(e.target.value); setAddAddressError(null) }}
                placeholder={STREAM_TYPE_ADDRESS_PLACEHOLDER[newStreamType] ?? 'srt://192.168.1.10:9000?mode=caller'}
                className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30"
              />
              {addAddressError && <p className="text-xs text-red-400 mt-1">{addAddressError}</p>}
            </div>
          )}
          {STREAM_TYPE_HAS_LATENCY[newStreamType] && (
            <div>
              <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">
                Latency <span className="normal-case opacity-60">(ms, default 125)</span>
              </label>
              <input
                type="number"
                min={20}
                max={8000}
                value={newLatency}
                placeholder="125"
                onChange={(e) => setNewLatency(e.target.value)}
                className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="active" onClick={handleAdd} disabled={!newName.trim()}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
