import { useState, useEffect } from 'react'
import { useOutputsStore, type OutputType } from '@/store/outputs.store'
import { useProductionsStore } from '@/store/productions.store'
import { useServerInfo } from '@/hooks/useServerInfo'
import { buildListenerAddress, isCallerAddress, listenerPort, passphraseOf, srtDirection, toCallerUrl, type SrtDirection } from '@/lib/srt'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { StatusDot } from '@/components/ui/StatusDot'
import { InlineCopyButton } from '@/components/ui/InlineCopyButton'
import { DirectionToggle, ListenerFields, inputCls, labelCls, listenerPortFor, listenerReady, useListenerPortMode } from '@/components/ui/SrtDirectionFields'

const CREATABLE_OUTPUT_TYPES: OutputType[] = ['mpegtssrt', 'efpsrt']

const OUTPUT_TYPE_LABELS: Record<OutputType, string> = {
  mpegtssrt: 'MPEG-TS/SRT',
  efpsrt: 'EFP/SRT',
  whep: 'WHEP',
}

const LISTENER_LABEL = 'Listener'
const CALLER_LABEL = 'Caller'

function timeSince(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

interface EditState {
  id: string
  name: string
  /** The URL as stored (passphrase masked by the backend). */
  stored: string
  direction: SrtDirection
  url: string
  port: number | null
  manualPort: string
  passphrase: string
}

export function OutputsPanel() {
  const { outputs, isLoading, lastFetchedAt, addOutput, updateOutput, removeOutput, fetchAll } = useOutputsStore()
  const productions = useProductionsStore((s) => s.productions)
  const { info } = useServerInfo()
  const portMode = useListenerPortMode()

  useEffect(() => {
    void fetchAll()
    const id = setInterval(() => void fetchAll(), 15000)
    return () => clearInterval(id)
  }, [fetchAll])

  const activeOutputIds = new Set(
    productions
      .filter((p) => p.status === 'active' || p.status === 'activating')
      .flatMap((p) => p.outputAssignments.map((o) => o.outputId)),
  )

  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EditState | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [addUrlError, setAddUrlError] = useState<string | null>(null)
  const [editUrlError, setEditUrlError] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<OutputType>('mpegtssrt')
  const [newDirection, setNewDirection] = useState<SrtDirection>('listener')
  const [newUrl, setNewUrl] = useState('')
  const [newManualPort, setNewManualPort] = useState('')
  const [newPassphrase, setNewPassphrase] = useState('')

  function resetAdd() {
    setNewName('')
    setNewType('mpegtssrt')
    setNewDirection('listener')
    setNewUrl('')
    setNewManualPort('')
    setNewPassphrase('')
    setAddUrlError(null)
  }

  function withCallerMode(url: string): string {
    return /[?&]mode=/i.test(url) ? url : url + (url.includes('?') ? '&' : '?') + 'mode=caller'
  }

  const addReady = !!newName.trim() && (newDirection === 'listener' ? listenerReady(portMode, newManualPort) : !!newUrl.trim())

  async function handleAdd() {
    if (!addReady) return
    let url: string
    if (newDirection === 'listener') {
      const port = listenerPortFor(portMode, newManualPort)
      if (port === null) return
      url = buildListenerAddress(port, newPassphrase)
    } else {
      if (!isCallerAddress(newUrl)) { setAddUrlError("Enter the destination's host and port, e.g. srt://cdn.example.com:9000?mode=caller"); return }
      url = withCallerMode(newUrl.trim())
      const duplicate = outputs.find((o) => o.url?.trim() === url)
      if (duplicate) { setAddUrlError(`Address already used by "${duplicate.name}"`); return }
    }
    await addOutput({ name: newName.trim(), outputType: newType, url })
    resetAdd()
    setAddOpen(false)
  }

  function openEdit(o: { id: string; name: string; url?: string }) {
    const stored = o.url ?? ''
    const direction = stored ? srtDirection(stored) : 'listener'
    setEditTarget({
      id: o.id,
      name: o.name,
      stored,
      direction,
      url: direction === 'caller' ? stored : '',
      port: direction === 'listener' ? listenerPort(stored) : null,
      manualPort: '',
      passphrase: '',
    })
    setEditUrlError(null)
  }

  const editReady = !!editTarget && !!editTarget.name.trim() &&
    (editTarget.direction === 'listener' ? listenerReady(portMode, editTarget.manualPort, editTarget.port) : !!editTarget.url.trim())

  async function handleEdit() {
    if (!editTarget || !editReady) return
    let url: string | undefined
    if (editTarget.direction === 'listener') {
      const switched = srtDirection(editTarget.stored) !== 'listener'
      // Unchanged port and no new passphrase: leave the stored URL alone, so the
      // masked passphrase the backend returned is never written back over the real one.
      if (switched || editTarget.passphrase.trim()) {
        const port = listenerPortFor(portMode, editTarget.manualPort, editTarget.port)
        if (port === null) return
        url = buildListenerAddress(port, editTarget.passphrase)
      }
    } else {
      if (!isCallerAddress(editTarget.url)) { setEditUrlError("Enter the destination's host and port, e.g. srt://cdn.example.com:9000?mode=caller"); return }
      url = withCallerMode(editTarget.url.trim())
      const duplicate = outputs.find((o) => o.id !== editTarget.id && o.url?.trim() === url)
      if (duplicate) { setEditUrlError(`Address already used by "${duplicate.name}"`); return }
      if (url === editTarget.stored) url = undefined
    }
    await updateOutput(editTarget.id, { name: editTarget.name.trim(), ...(url !== undefined ? { url } : {}) })
    setEditUrlError(null)
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
        <Button size="sm" variant="active" onClick={() => setAddOpen(true)}>+ New Output</Button>
      </div>

      <div className="flex flex-col gap-1">
        {outputs.map((o) => {
          const inActiveProd = activeOutputIds.has(o.id)
          const listener = !!o.url && srtDirection(o.url) === 'listener'
          const viewer = listener && o.url ? toCallerUrl(o.url, info?.stromHost) : null
          return (
            <div
              key={o.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded bg-[--color-surface-3] border transition-colors ${
                inActiveProd
                  ? 'border-[--color-border] hover:border-zinc-600 cursor-not-allowed'
                  : 'border-[--color-border] hover:border-orange-500 cursor-pointer'
              }`}
              onClick={() => !inActiveProd && openEdit(o)}
            >
              <StatusDot color={inActiveProd ? 'red' : 'gray'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[--color-text-primary] truncate">{o.name}</span>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted] uppercase">
                    {OUTPUT_TYPE_LABELS[o.outputType]}
                  </span>
                  {viewer && <InlineCopyButton label="Viewer address" value={viewer} />}
                </div>
                {o.url && (
                  <span className="text-xs text-[--color-text-muted] font-mono truncate block">
                    {viewer ? `viewers dial ${viewer}${passphraseOf(o.url ?? '') ? ' with the passphrase' : ''}` : o.url}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); if (!inActiveProd) openEdit(o) }}
                disabled={inActiveProd}
                className="text-white hover:text-orange-500 disabled:opacity-30 disabled:cursor-not-allowed"
                title={inActiveProd ? 'Cannot edit output in an active production' : 'Edit output'}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); setDeleteError(null); setDeleteTargetId(o.id) }}
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
      <Modal open={addOpen} title="New Output" onClose={() => { resetAdd(); setAddOpen(false) }}>
        <div className="flex flex-col gap-3">
          <div>
            <label className={labelCls}>Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Program SRT"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <div className="grid grid-cols-2 gap-2">
              {CREATABLE_OUTPUT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNewType(t)}
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
          <DirectionToggle
            value={newDirection}
            onChange={(d) => { setNewDirection(d); setAddUrlError(null) }}
            listenerLabel={LISTENER_LABEL}
            callerLabel={CALLER_LABEL}
          />
          {newDirection === 'listener' ? (
            <ListenerFields
              mode={portMode}
              manualPort={newManualPort}
              onManualPort={setNewManualPort}
              passphrase={newPassphrase}
              onPassphrase={setNewPassphrase}
            />
          ) : (
            <div>
              <label className={labelCls}>Destination address</label>
              <input
                type="text"
                value={newUrl}
                onChange={(e) => { setNewUrl(e.target.value); setAddUrlError(null) }}
                placeholder="srt://cdn.example.com:9000?mode=caller"
                className={inputCls}
              />
              {addUrlError && <p className="text-xs text-red-400 mt-1">{addUrlError}</p>}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => { resetAdd(); setAddOpen(false) }}>Cancel</Button>
            <Button variant="active" onClick={() => void handleAdd()} disabled={!addReady}>
              Save
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      {editTarget && (
        <Modal open title="Edit Output" onClose={() => { setEditTarget(null); setEditUrlError(null) }}>
          <div className="flex flex-col gap-3">
            <div>
              <label className={labelCls}>Name</label>
              <input
                type="text"
                value={editTarget.name}
                onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })}
                className={inputCls}
              />
            </div>
            <DirectionToggle
              value={editTarget.direction}
              onChange={(direction) => { setEditTarget({ ...editTarget, direction }); setEditUrlError(null) }}
              listenerLabel={LISTENER_LABEL}
              callerLabel={CALLER_LABEL}
            />
            {editTarget.direction === 'listener' ? (
              <>
                <ListenerFields
                  mode={portMode}
                  manualPort={editTarget.manualPort}
                  onManualPort={(manualPort) => setEditTarget({ ...editTarget, manualPort })}
                  passphrase={editTarget.passphrase}
                  onPassphrase={(passphrase) => setEditTarget({ ...editTarget, passphrase })}
                  keepPort={srtDirection(editTarget.stored) === 'listener' ? editTarget.port : null}
                  hasPassphrase={passphraseOf(editTarget.stored) !== null}
                />
                {editTarget.port && srtDirection(editTarget.stored) === 'listener' && (
                  <p className="text-xs text-[--color-text-muted] font-mono break-all">
                    Viewers dial {toCallerUrl(editTarget.stored, info?.stromHost)}{passphraseOf(editTarget.stored) ? ' with the passphrase' : ''}
                  </p>
                )}
              </>
            ) : (
              <div>
                <label className={labelCls}>Destination address</label>
                <input
                  type="text"
                  value={editTarget.url}
                  placeholder="srt://cdn.example.com:9000?mode=caller"
                  onChange={(e) => { setEditTarget({ ...editTarget, url: e.target.value }); setEditUrlError(null) }}
                  className={inputCls}
                />
                {editUrlError && <p className="text-xs text-red-400 mt-1">{editUrlError}</p>}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => { setEditTarget(null); setEditUrlError(null) }}>Cancel</Button>
              <Button variant="active" onClick={() => void handleEdit()} disabled={!editReady}>
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
