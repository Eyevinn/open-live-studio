import { useState, useEffect } from 'react'
import { useOutputsStore, type OutputType, type Output } from '@/store/outputs.store'
import { useProductionsStore } from '@/store/productions.store'
import { useServerInfo } from '@/hooks/useServerInfo'
import type { OutputStatus, RtmpDestinationInput, RtmpPlatform } from '@/lib/api'
import { buildListenerAddress, isCallerAddress, listenerPort, passphraseOf, srtDirection, toCallerUrl, type SrtDirection } from '@/lib/srt'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { StatusDot } from '@/components/ui/StatusDot'
import { InlineCopyButton } from '@/components/ui/InlineCopyButton'
import { DirectionToggle, ListenerFields, inputCls, labelCls, listenerPortFor, listenerReady, useListenerPortMode } from '@/components/ui/SrtDirectionFields'
import { RtmpFields, RTMP_PLATFORM_LABELS, streamKeyError, customUrlMissing } from '@/components/ui/RtmpDestinationFields'
import { useStorageStore } from '@/store/storage.store'
import {
  NO_STORAGE_AVAILABLE,
  outputSaveErrorMessage,
  recordingCreateInput,
  recordingPatchInput,
  recordingStorageLabel,
  recordingStorageOptions,
  storageSelection,
} from '@/lib/recordingOutput'

const CREATABLE_OUTPUT_TYPES: OutputType[] = ['mpegtssrt', 'efpsrt', 'rtmp', 'recording']

const OUTPUT_TYPE_LABELS: Record<OutputType, string> = {
  mpegtssrt: 'MPEG-TS/SRT',
  efpsrt: 'EFP/SRT',
  whep: 'WHEP',
  rtmp: 'RTMP',
  recording: 'Recording',
}

const LISTENER_LABEL = 'Listener'
const CALLER_LABEL = 'Caller'

/** Render the derived output health (open-live #255) as a badge. Flow-level in v1. */
function StatusBadge({ status }: { status: OutputStatus }) {
  switch (status) {
    case 'healthy': return <Badge variant="connected" label="HEALTHY" />
    case 'degraded': return <Badge variant="connecting" label="DEGRADED" />
    case 'down': return <Badge variant="error" label="DOWN" />
    case 'unknown': return <Badge variant="idle" label="UNKNOWN" />
  }
}

function timeSince(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

interface EditState {
  id: string
  name: string
  outputType: OutputType
  /** The URL as stored (passphrase masked by the backend). SRT outputs only. */
  stored: string
  direction: SrtDirection
  url: string
  port: number | null
  manualPort: string
  passphrase: string
  // RTMP-only fields (present when outputType === 'rtmp').
  platform: RtmpPlatform
  /** Resolved ingest URL as stored (custom carries the operator URL; presets a table URL). */
  ingestUrl: string
  /** Whether a stream key is stored server-side (from `streamKeySet`). */
  keyStored: boolean
  /** A replacement stream key the operator is entering. Never seeded from the server. */
  streamKey: string
  /** Operator asked to clear the stored key. */
  clearKey: boolean
  // Recording-only fields (present when outputType === 'recording').
  /** `connectionId` as stored; absent or "default" = the instance default. */
  connectionId?: string
  /** Storage selector value: '' = default, else a stored connection id. */
  storage: string
}

interface RecordingStorageFieldProps {
  value: string
  onChange: (value: string) => void
  /** Selection stored on the output being edited; kept as an option even if no longer offered. */
  current?: string
  onOpenStorage?: () => void
}

/**
 * Storage selector of a Recording output (studio#219): the default entry plus
 * stored connections with role `recording` or `both`. With nothing selectable it
 * shows "No storage available" and a link to the Storage tab; the dialog then
 * disables Save (see `recordingStorageReady`).
 */
function RecordingStorageField({ value, onChange, current, onOpenStorage }: RecordingStorageFieldProps) {
  const connections = useStorageStore((s) => s.connections)
  const loaded = useStorageStore((s) => s.loaded)
  const loadError = useStorageStore((s) => s.loadError)
  const fetchStorage = useStorageStore((s) => s.fetchAll)
  const { options, available } = recordingStorageOptions(connections, current)

  if (!loaded) {
    return (
      <div>
        <label className={labelCls}>Storage</label>
        {loadError ? (
          <p className="text-xs text-red-400">
            Could not load storage connections: {loadError}{' '}
            <button type="button" className="underline hover:text-orange-500" onClick={() => void fetchStorage()}>Retry</button>
          </p>
        ) : (
          <p className="text-xs text-[--color-text-muted]">Loading storage connections…</p>
        )}
      </div>
    )
  }

  if (!available && current === undefined) {
    return (
      <div>
        <label className={labelCls}>Storage</label>
        <p className="text-sm text-amber-400">{NO_STORAGE_AVAILABLE}</p>
        <p className="text-xs text-[--color-text-muted] mt-1">
          This server has no default storage and no recording storage connection with a default bucket.{' '}
          {onOpenStorage
            ? <button type="button" className="underline text-[--color-accent] hover:text-orange-500" onClick={onOpenStorage}>Add one in the Storage tab</button>
            : 'Add one in the Storage tab'}
          .
        </p>
      </div>
    )
  }

  return (
    <div>
      <label className={labelCls}>Storage</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map((o) => (
          <option key={o.value || '__default__'} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
      <p className="text-xs text-[--color-text-muted] mt-1">
        Where the recording is uploaded when the production is deactivated. Offers the default storage and connections with the role Recordings or Clips and recordings.
      </p>
    </div>
  )
}

/** True when the selector holds a selectable value (connections loaded, option enabled). */
function recordingStorageReady(
  connections: Parameters<typeof recordingStorageOptions>[0],
  loaded: boolean,
  value: string,
  current?: string,
): boolean {
  if (!loaded) return false
  return recordingStorageOptions(connections, current).options.some((o) => o.value === value && !o.disabled)
}

interface OutputsPanelProps {
  /** Switches Setup to the Storage tab (the "No storage available" link). */
  onOpenStorage?: () => void
}

export function OutputsPanel({ onOpenStorage }: OutputsPanelProps = {}) {
  const { outputs, isLoading, lastFetchedAt, addOutput, updateOutput, removeOutput, fetchAll } = useOutputsStore()
  const productions = useProductionsStore((s) => s.productions)
  const { info } = useServerInfo()
  const portMode = useListenerPortMode()
  const storageConnections = useStorageStore((s) => s.connections)
  const storageLoaded = useStorageStore((s) => s.loaded)
  const fetchStorage = useStorageStore((s) => s.fetchAll)

  useEffect(() => {
    void fetchAll()
    const id = setInterval(() => void fetchAll(), 15000)
    return () => clearInterval(id)
  }, [fetchAll])

  // Connection names for Recording rows and the storage selector.
  useEffect(() => { void fetchStorage() }, [fetchStorage])

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
  // Backend message of a failed create/update, shown once inside the dialog
  // (the API calls are quiet, so there is no toast as well).
  const [addError, setAddError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<OutputType>('mpegtssrt')
  const [newDirection, setNewDirection] = useState<SrtDirection>('listener')
  const [newUrl, setNewUrl] = useState('')
  const [newManualPort, setNewManualPort] = useState('')
  const [newPassphrase, setNewPassphrase] = useState('')
  const [newPlatform, setNewPlatform] = useState<RtmpPlatform>('youtube')
  const [newCustomUrl, setNewCustomUrl] = useState('')
  const [newStreamKey, setNewStreamKey] = useState('')
  const [newStorage, setNewStorage] = useState('')

  function resetAdd() {
    setNewName('')
    setNewType('mpegtssrt')
    setNewDirection('listener')
    setNewUrl('')
    setNewManualPort('')
    setNewPassphrase('')
    setNewPlatform('youtube')
    setNewCustomUrl('')
    setNewStreamKey('')
    setNewStorage('')
    setAddUrlError(null)
    setAddError(null)
  }

  function withCallerMode(url: string): string {
    return /[?&]mode=/i.test(url) ? url : url + (url.includes('?') ? '&' : '?') + 'mode=caller'
  }

  const rtmpAddReady =
    !!newStreamKey.trim() && !streamKeyError(newStreamKey) && !customUrlMissing(newPlatform, newCustomUrl)
  // The selector starts on the default; when the server has none, fall back to
  // the first selectable connection so Save sends a real target.
  const addStorageOptions = recordingStorageOptions(storageConnections).options
  const newStorageValue = addStorageOptions.some((o) => o.value === newStorage && !o.disabled)
    ? newStorage
    : (addStorageOptions.find((o) => !o.disabled)?.value ?? newStorage)
  const addReady = !!newName.trim() && !saving && (
    newType === 'rtmp'
      ? rtmpAddReady
      : newType === 'recording'
        ? recordingStorageReady(storageConnections, storageLoaded, newStorageValue)
        : newDirection === 'listener' ? listenerReady(portMode, newManualPort) : !!newUrl.trim()
  )

  async function submitAdd(body: Parameters<typeof addOutput>[0]) {
    setAddError(null)
    setSaving(true)
    try {
      await addOutput(body)
      resetAdd()
      setAddOpen(false)
    } catch (err) {
      // Keep the dialog open with the entered values; show the backend message once.
      setAddError(outputSaveErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleAdd() {
    if (!addReady) return
    if (newType === 'recording') {
      await submitAdd(recordingCreateInput(newName, newStorageValue))
      return
    }
    if (newType === 'rtmp') {
      const rtmp: RtmpDestinationInput = {
        platform: newPlatform,
        streamKey: newStreamKey,
        ...(newPlatform === 'custom' ? { ingestUrl: newCustomUrl.trim() } : {}),
      }
      await submitAdd({ name: newName.trim(), outputType: 'rtmp', rtmp })
      return
    }
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
    await submitAdd({ name: newName.trim(), outputType: newType, url })
  }

  function openEdit(o: Output) {
    const stored = o.url ?? ''
    const direction = stored ? srtDirection(stored) : 'listener'
    setEditTarget({
      id: o.id,
      name: o.name,
      outputType: o.outputType,
      stored,
      direction,
      url: direction === 'caller' ? stored : '',
      port: direction === 'listener' ? listenerPort(stored) : null,
      manualPort: '',
      passphrase: '',
      platform: o.rtmp?.platform ?? 'youtube',
      ingestUrl: o.rtmp?.ingestUrl ?? '',
      keyStored: !!o.rtmp?.streamKeySet,
      streamKey: '',
      clearKey: false,
      connectionId: o.connectionId,
      storage: storageSelection(o.connectionId),
    })
    setEditUrlError(null)
    setEditError(null)
  }

  function closeEdit() {
    setEditTarget(null)
    setEditUrlError(null)
    setEditError(null)
  }

  const editReady = !!editTarget && !!editTarget.name.trim() && !saving && (
    editTarget.outputType === 'recording'
      ? recordingStorageReady(storageConnections, storageLoaded, editTarget.storage, storageSelection(editTarget.connectionId)) ||
        // Unchanged storage (even one no longer offered) can be kept on a rename.
        editTarget.storage === storageSelection(editTarget.connectionId)
      : editTarget.outputType === 'rtmp'
      ? (editTarget.platform !== 'custom' || !!editTarget.ingestUrl.trim()) &&
        !(editTarget.streamKey.length > 0 && streamKeyError(editTarget.streamKey))
      : editTarget.direction === 'listener'
        ? listenerReady(portMode, editTarget.manualPort, editTarget.port)
        : !!editTarget.url.trim()
  )

  async function submitEdit(id: string, body: Parameters<typeof updateOutput>[1]) {
    setEditError(null)
    setSaving(true)
    try {
      if (Object.keys(body).length > 0) await updateOutput(id, body)
      closeEdit()
    } catch (err) {
      // Keep the dialog open with the entered values; show the backend message once.
      setEditError(outputSaveErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!editTarget || !editReady) return
    if (editTarget.outputType === 'recording') {
      const original = outputs.find((o) => o.id === editTarget.id)
      await submitEdit(
        editTarget.id,
        recordingPatchInput(editTarget.name, { name: original?.name ?? '', connectionId: editTarget.connectionId }, editTarget.storage),
      )
      return
    }
    if (editTarget.outputType === 'rtmp') {
      // Build the write-only rtmp patch. streamKey: cleared → '', a new key →
      // send it, otherwise omitted so the stored ciphertext is kept untouched.
      const rtmp: RtmpDestinationInput = { platform: editTarget.platform }
      if (editTarget.platform === 'custom') rtmp.ingestUrl = editTarget.ingestUrl.trim()
      if (editTarget.clearKey) rtmp.streamKey = ''
      else if (editTarget.streamKey.trim()) rtmp.streamKey = editTarget.streamKey
      await submitEdit(editTarget.id, { name: editTarget.name.trim(), rtmp })
      return
    }
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
    await submitEdit(editTarget.id, { name: editTarget.name.trim(), ...(url !== undefined ? { url } : {}) })
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
                  {o.outputType === 'rtmp' && o.status && <StatusBadge status={o.status} />}
                  {viewer && <InlineCopyButton label="Viewer address" value={viewer} />}
                </div>
                {o.outputType === 'recording' && (
                  <span className="text-xs text-[--color-text-muted] font-mono truncate block">
                    Storage: {storageLoaded ? recordingStorageLabel(o.connectionId, storageConnections) : (storageSelection(o.connectionId) || 'Default')}
                  </span>
                )}
                {o.rtmp && (
                  <span className="text-xs text-[--color-text-muted] font-mono truncate block">
                    {RTMP_PLATFORM_LABELS[o.rtmp.platform]} · {o.rtmp.ingestUrl} · {o.rtmp.streamKeySet ? 'key set' : 'no key'}
                  </span>
                )}
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
      <Modal
        open={addOpen}
        title="New Output"
        onClose={() => { resetAdd(); setAddOpen(false) }}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { resetAdd(); setAddOpen(false) }}>Cancel</Button>
            <Button variant="active" onClick={() => void handleAdd()} disabled={!addReady}>
              Save
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <label className={labelCls}>Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={newType === 'recording' ? 'Program recording' : 'Program SRT'}
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
                  onClick={() => { setNewType(t); setAddError(null) }}
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
          {newType === 'recording' ? (
            <RecordingStorageField
              value={newStorageValue}
              onChange={(v) => { setNewStorage(v); setAddError(null) }}
              onOpenStorage={onOpenStorage ? () => { resetAdd(); setAddOpen(false); onOpenStorage() } : undefined}
            />
          ) : newType === 'rtmp' ? (
            <RtmpFields
              platform={newPlatform}
              onPlatform={setNewPlatform}
              customUrl={newCustomUrl}
              onCustomUrl={setNewCustomUrl}
              streamKey={newStreamKey}
              onStreamKey={setNewStreamKey}
            />
          ) : (
            <>
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
            </>
          )}
          {addError && <p className="text-xs text-red-400" role="alert">{addError}</p>}
        </div>
      </Modal>

      {/* Edit modal */}
      {editTarget && (
        <Modal open title="Edit Output" onClose={closeEdit}>
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
            {editTarget.outputType === 'recording' ? (
              <RecordingStorageField
                value={editTarget.storage}
                current={storageSelection(editTarget.connectionId)}
                onChange={(storage) => { setEditTarget({ ...editTarget, storage }); setEditError(null) }}
                onOpenStorage={onOpenStorage ? () => { closeEdit(); onOpenStorage() } : undefined}
              />
            ) : editTarget.outputType === 'rtmp' ? (
              <RtmpFields
                platform={editTarget.platform}
                onPlatform={(platform) => setEditTarget({ ...editTarget, platform })}
                customUrl={editTarget.ingestUrl}
                onCustomUrl={(ingestUrl) => setEditTarget({ ...editTarget, ingestUrl })}
                streamKey={editTarget.streamKey}
                onStreamKey={(streamKey) => setEditTarget({ ...editTarget, streamKey })}
                keyStored={editTarget.keyStored}
                clearKey={editTarget.clearKey}
                onClearKey={(clearKey) => setEditTarget({ ...editTarget, clearKey })}
                resolvedIngestUrl={editTarget.platform !== 'custom' ? editTarget.ingestUrl : undefined}
              />
            ) : (
              <>
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
              </>
            )}
            {editError && <p className="text-xs text-red-400" role="alert">{editError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={closeEdit}>Cancel</Button>
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
