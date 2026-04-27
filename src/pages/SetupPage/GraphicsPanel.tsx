import { useState } from 'react'
import { useGraphicsStore } from '@/store/graphics.store'
import { useProductionsStore } from '@/store/productions.store'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { StatusDot } from '@/components/ui/StatusDot'

function timeSince(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

export function GraphicsPanel() {
  const { graphics, isLoading, lastFetchedAt, addGraphic, updateGraphic, removeGraphic } = useGraphicsStore()
  const productions = useProductionsStore((s) => s.productions)

  // Graphic IDs currently assigned to an active or activating production
  const activeGraphicIds = new Set(
    productions
      .filter((p) => p.status === 'active' || p.status === 'activating')
      .flatMap((p) => p.graphicAssignments.map((g) => g.graphicId)),
  )

  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; url: string } | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')

  function handleAdd() {
    if (!newName.trim() || !newUrl.trim()) return
    void addGraphic({ name: newName.trim(), url: newUrl.trim() })
    setNewName('')
    setNewUrl('')
    setAddOpen(false)
  }

  function handleEdit() {
    if (!editTarget || !editTarget.name.trim() || !editTarget.url.trim()) return
    void updateGraphic(editTarget.id, { name: editTarget.name.trim(), url: editTarget.url.trim() })
    setEditTarget(null)
  }

  const deleteTarget = deleteTargetId ? graphics.find((g) => g.id === deleteTargetId) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[--color-text-muted] font-mono">
            {graphics.length} graphics · refreshed {timeSince(lastFetchedAt)}
          </span>
          {isLoading && <span className="text-xs text-[--color-accent]">Refreshing…</span>}
        </div>
        <Button size="sm" variant="active" onClick={() => setAddOpen(true)}>+ Add Graphic</Button>
      </div>

      <div className="flex flex-col gap-1">
        {graphics.map((g) => {
          const inActiveProduction = activeGraphicIds.has(g.id)
          return (
            <div
              key={g.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded bg-[--color-surface-3] border transition-colors ${
                inActiveProduction
                  ? 'border-[--color-border] hover:border-zinc-600 cursor-not-allowed'
                  : 'border-[--color-border] hover:border-orange-500 cursor-pointer'
              }`}
            >
              <StatusDot color={inActiveProduction ? 'red' : 'gray'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[--color-text-primary] truncate">{g.name}</span>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted] uppercase">
                    DSK
                  </span>
                </div>
                <span className="text-xs text-[--color-text-muted] font-mono truncate block">{g.url}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => !inActiveProduction && setEditTarget({ id: g.id, name: g.name, url: g.url })}
                disabled={inActiveProduction}
                className="text-white hover:text-orange-500 disabled:opacity-30 disabled:cursor-not-allowed"
                title={inActiveProduction ? 'Cannot edit graphic in an active production' : 'Edit graphic'}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDeleteTargetId(g.id)}
                disabled={inActiveProduction}
                className="text-white hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                title={inActiveProduction ? 'Graphic is in an active production' : 'Delete graphic'}
              >
                Delete
              </Button>
            </div>
          )
        })}
        {graphics.length === 0 && !isLoading && (
          <p className="text-sm text-[--color-text-muted] py-4 text-center">
            No graphics yet. Add one to use as a DSK overlay.
          </p>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <Modal open title="Delete Graphic" onClose={() => setDeleteTargetId(null)} className="max-w-sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[--color-text-primary]">
              Delete <span className="font-semibold">{deleteTarget.name}</span>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteTargetId(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  void removeGraphic(deleteTarget.id)
                  setDeleteTargetId(null)
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add modal */}
      <Modal open={addOpen} title="Add Graphic" onClose={() => setAddOpen(false)}>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Lower Third"
              className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
            />
          </div>
          <div>
            <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">URL</label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/overlay"
              className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              variant="active"
              onClick={handleAdd}
              disabled={!newName.trim() || !newUrl.trim()}
            >
              Add Graphic
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      {editTarget && (
        <Modal open title="Edit Graphic" onClose={() => setEditTarget(null)}>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">Name</label>
              <input
                type="text"
                value={editTarget.name}
                onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })}
                className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
              />
            </div>
            <div>
              <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">URL</label>
              <input
                type="url"
                value={editTarget.url}
                onChange={(e) => setEditTarget({ ...editTarget, url: e.target.value })}
                className="w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button
                variant="active"
                onClick={handleEdit}
                disabled={!editTarget.name.trim() || !editTarget.url.trim()}
              >
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
