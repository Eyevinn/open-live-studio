import { useState } from 'react'
import { useOutputsStore, type OutputType } from '@/store/outputs.store'
import { useProductionsStore } from '@/store/productions.store'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { StatusDot } from '@/components/ui/StatusDot'

const CREATABLE_OUTPUT_TYPES: OutputType[] = ['mpegtssrt', 'efpsrt']

const OUTPUT_TYPE_LABELS: Record<OutputType, string> = {
  mpegtssrt: 'MPEG-TS/SRT',
  efpsrt: 'EFP/SRT',
  whep: 'WHEP',
}

function timeSince(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

const inputCls = 'w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent]'

export function OutputsPanel() {
  const { outputs, isLoading, lastFetchedAt, addOutput, updateOutput, removeOutput } = useOutputsStore()
  const productions = useProductionsStore((s) => s.productions)

  const activeOutputIds = new Set(
    productions
      .filter((p) => p.status === 'active' || p.status === 'activating')
      .flatMap((p) => p.outputAssignments.map((o) => o.outputId)),
  )

  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; url: string } | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<OutputType>('mpegtssrt')
  const [newUrl, setNewUrl] = useState('srt://:43524?mode=listener')

  function resetAdd() {
    setNewName('')
    setNewType('mpegtssrt')
    setNewUrl('srt://:43524?mode=listener')
  }

  async function handleAdd() {
    if (!newName.trim() || !newUrl.trim()) return
    await addOutput({ name: newName.trim(), outputType: newType, url: newUrl.trim() })
    resetAdd()
    setAddOpen(false)
  }

  async function handleEdit() {
    if (!editTarget || !editTarget.name.trim()) return
    await updateOutput(editTarget.id, { name: editTarget.name.trim(), url: editTarget.url.trim() || undefined })
    setEditTarget(null)
  }

  async function handleDelete(id: string) {
    setDeleteError(null)
    try {
      await removeOutput(id)
      setDeleteTargetId(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete output')
    }
  }

  const deleteTarget = deleteTargetId ? outputs.find((o) => o.id === deleteTargetId) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[--color-text-muted] font-mono">
            {outputs.length} outputs · refreshed {timeSince(lastFetchedAt)}
          </span>
          {isLoading && <span className="text-xs text-[--color-accent]">Refreshing…</span>}
        </div>
        <Button size="sm" variant="active" onClick={() => setAddOpen(true)}>+ Add Output</Button>
      </div>

      <div className="flex flex-col gap-1">
        {outputs.map((o) => {
          const inActiveProd = activeOutputIds.has(o.id)
          return (
            <div
              key={o.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded bg-[--color-surface-3] border transition-colors ${
                inActiveProd
                  ? 'border-[--color-border] hover:border-zinc-600 cursor-not-allowed'
                  : 'border-[--color-border] hover:border-orange-500 cursor-pointer'
              }`}
            >
              <StatusDot color={inActiveProd ? 'red' : 'gray'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[--color-text-primary] truncate">{o.name}</span>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted] uppercase">
                    {OUTPUT_TYPE_LABELS[o.outputType]}
                  </span>
                </div>
                {o.url && (
                  <span className="text-xs text-[--color-text-muted] font-mono truncate block">{o.url}</span>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => !inActiveProd && setEditTarget({ id: o.id, name: o.name, url: o.url ?? '' })}
                disabled={inActiveProd}
                className="text-white hover:text-orange-500 disabled:opacity-30 disabled:cursor-not-allowed"
                title={inActiveProd ? 'Cannot edit output in an active production' : 'Edit output'}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setDeleteError(null); setDeleteTargetId(o.id) }}
                disabled={inActiveProd}
                className="text-white hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                title={inActiveProd ? 'Output is in an active production' : 'Delete output'}
              >
                Delete
              </Button>
            </div>
          )
        })}
        {outputs.length === 0 && !isLoading && (
          <p className="text-sm text-[--color-text-muted] py-4 text-center">
            No outputs yet. Add one to send program video to an external destination.
          </p>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteTarget && (
        <Modal open title="Delete Output" onClose={() => { setDeleteTargetId(null); setDeleteError(null) }} className="max-w-sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[--color-text-primary]">
              Delete <span className="font-semibold">{deleteTarget.name}</span>? This cannot be undone.
            </p>
            {deleteError && <p className="text-xs text-red-400">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setDeleteTargetId(null); setDeleteError(null) }}>Cancel</Button>
              <Button variant="danger" onClick={() => void handleDelete(deleteTarget.id)}>Delete</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add modal */}
      <Modal open={addOpen} title="Add Output" onClose={() => { resetAdd(); setAddOpen(false) }}>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Program SRT"
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {CREATABLE_OUTPUT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setNewType(t); setNewUrl('srt://:43524?mode=listener') }}
                  className={`py-2 rounded text-sm border transition-colors ${
                    newType === t
                      ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-surface-2)] border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-orange-500'
                  }`}
                >
                  {OUTPUT_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">SRT URI</label>
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="srt://:43524?mode=listener"
              className={inputCls}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => { resetAdd(); setAddOpen(false) }}>Cancel</Button>
            <Button variant="active" onClick={() => void handleAdd()} disabled={!newName.trim() || !newUrl.trim()}>
              Add Output
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      {editTarget && (
        <Modal open title="Edit Output" onClose={() => setEditTarget(null)}>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Name</label>
              <input
                type="text"
                value={editTarget.name}
                onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">SRT URI</label>
              <input
                type="text"
                value={editTarget.url}
                onChange={(e) => setEditTarget({ ...editTarget, url: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button variant="active" onClick={() => void handleEdit()} disabled={!editTarget.name.trim()}>
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
