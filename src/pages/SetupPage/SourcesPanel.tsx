import { useState, useEffect } from 'react'
import { useSourcesStore } from '@/store/sources.store'
import { useProductionsStore } from '@/store/productions.store'
import { useGatewaysStore } from '@/store/gateways.store'
import { useServerInfo } from '@/hooks/useServerInfo'
import type { StreamType } from '@/lib/api'
import { heartbeatAge, indexGatewaysBySource } from '@/lib/gateway'
import { buildListenerAddress, isCallerAddress, listenerPort, passphraseOf, srtDirection, toCallerUrl, type SrtDirection } from '@/lib/srt'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { Modal } from '@/components/ui/Modal'
import { InlineCopyButton } from '@/components/ui/InlineCopyButton'
import { DirectionToggle, ListenerFields, inputCls, labelCls, listenerPortFor, listenerReady, useListenerPortMode } from '@/components/ui/SrtDirectionFields'
import { useIsPhone } from '@/hooks/usePhoneLayout'

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

const CREATABLE_STREAM_TYPES: StreamType[] = ['srt', 'efp', 'html']

function isSrt(t: StreamType): boolean {
  return t === 'srt' || t === 'efp'
}

const LISTENER_LABEL = 'Listener'
const CALLER_LABEL = 'Caller'

interface EditState {
  id: string
  name: string
  streamType: StreamType
  latency: string
  /** The address as stored (passphrase masked by the backend). */
  stored: string
  direction: SrtDirection
  /** Caller mode, or HTML: the editable address. */
  address: string
  /** Listener mode: the port the source already holds, kept on save. */
  port: number | null
  manualPort: string
  passphrase: string
}

export function SourcesPanel() {
  // Phone tier (<768px): read-only. Hide every state-mutating control (#105).
  const isPhone = useIsPhone()
  const { sources, isLoading, lastFetchedAt, removeSource, addSource, updateSource, fetchAll } = useSourcesStore()
  const productions = useProductionsStore((s) => s.productions)
  const gateways = useGatewaysStore((s) => s.gateways)
  const fetchGateways = useGatewaysStore((s) => s.fetchAll)
  const { info } = useServerInfo()
  const portMode = useListenerPortMode()

  useEffect(() => {
    void fetchAll()
    const id = setInterval(() => void fetchAll(), 15000)
    return () => clearInterval(id)
  }, [fetchAll])

  // Gateway-fed sources: poll gateways so the "via <gateway>" chip, live uplink
  // stats and offline banner stay fresh (open-live #263, read-only Phase 1).
  useEffect(() => {
    void fetchGateways()
    const id = setInterval(() => void fetchGateways(), 5000)
    return () => clearInterval(id)
  }, [fetchGateways])

  // source id -> { gateway, input } for gateway-owned sources.
  const gatewayBySource = indexGatewaysBySource(gateways)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<EditState | null>(null)
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newStreamType, setNewStreamType] = useState<StreamType>('srt')
  const [newDirection, setNewDirection] = useState<SrtDirection>('listener')
  const [newManualPort, setNewManualPort] = useState('')
  const [newPassphrase, setNewPassphrase] = useState('')
  const [newLatency, setNewLatency] = useState('')
  const [addAddressError, setAddAddressError] = useState<string | null>(null)
  const [editAddressError, setEditAddressError] = useState<string | null>(null)

  // Source IDs currently assigned to an active or activating production
  const activeSourceIds = new Set(
    productions
      .filter((p) => p.status === 'active' || p.status === 'activating')
      .flatMap((p) => p.sources.map((s) => s.sourceId)),
  )

  function validateAddress(address: string, streamType: StreamType, direction: SrtDirection): string | null {
    if (!STREAM_TYPE_HAS_ADDRESS[streamType]) return null
    if (isSrt(streamType) && direction === 'listener') return null
    if (!address.trim()) return 'Address is required'
    if (streamType === 'html') {
      try { const u = new URL(address); if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error() }
      catch { return 'Must be a valid http:// or https:// URL' }
    } else if (!isCallerAddress(address)) {
      return "Enter the sender's host and port, e.g. srt://sender.example.com:9000?mode=caller"
    }
    return null
  }

  function resetAdd() {
    setNewName('')
    setNewAddress('')
    setNewStreamType('srt')
    setNewDirection('listener')
    setNewManualPort('')
    setNewPassphrase('')
    setNewLatency('')
    setAddAddressError(null)
  }

  const newIsListener = isSrt(newStreamType) && newDirection === 'listener'
  const addReady = !!newName.trim() && (!newIsListener || listenerReady(portMode, newManualPort))

  function handleAdd() {
    if (!addReady) return
    const addrErr = validateAddress(newAddress, newStreamType, newDirection)
    if (addrErr) { setAddAddressError(addrErr); return }
    let address = newAddress.trim()
    if (newIsListener) {
      const port = listenerPortFor(portMode, newManualPort)
      if (port === null) return
      address = buildListenerAddress(port, newPassphrase)
    } else if (isSrt(newStreamType) && !/[?&]mode=/i.test(address)) {
      address += (address.includes('?') ? '&' : '?') + 'mode=caller'
    }
    addSource({
      name: newName.trim(),
      address,
      streamType: newStreamType,
      status: 'inactive',
      color: '#27272a',
      ...(STREAM_TYPE_HAS_LATENCY[newStreamType] ? { latency: parseInt(newLatency, 10) || 125 } : {}),
    })
    resetAdd()
    setAddOpen(false)
  }

  function openEdit(src: { id: string; name: string; address?: string; latency?: number; streamType: StreamType }) {
    const stored = src.address ?? ''
    const direction: SrtDirection = isSrt(src.streamType) ? srtDirection(stored) : 'caller'
    setEditTarget({
      id: src.id,
      name: src.name,
      streamType: src.streamType,
      latency: src.latency != null ? String(src.latency) : '',
      stored,
      direction,
      address: direction === 'caller' ? stored : '',
      port: direction === 'listener' ? listenerPort(stored) : null,
      manualPort: '',
      passphrase: '',
    })
    setEditAddressError(null)
  }

  const editIsListener = !!editTarget && isSrt(editTarget.streamType) && editTarget.direction === 'listener'
  const editReady = !!editTarget && !!editTarget.name.trim() && (!editIsListener || listenerReady(portMode, editTarget.manualPort, editTarget.port))

  function handleEdit() {
    if (!editTarget || !editReady) return
    const addrErr = validateAddress(editTarget.address, editTarget.streamType, editTarget.direction)
    if (addrErr) { setEditAddressError(addrErr); return }
    let address: string | undefined
    if (editIsListener) {
      const switched = srtDirection(editTarget.stored) !== 'listener'
      // Unchanged port and no new passphrase: leave the stored address alone, so the
      // masked passphrase the backend returned is never written back over the real one.
      if (switched || editTarget.passphrase.trim()) {
        const port = listenerPortFor(portMode, editTarget.manualPort, editTarget.port)
        if (port === null) return
        address = buildListenerAddress(port, editTarget.passphrase)
      }
    } else if (STREAM_TYPE_HAS_ADDRESS[editTarget.streamType]) {
      address = editTarget.address.trim()
      if (isSrt(editTarget.streamType) && !/[?&]mode=/i.test(address)) {
        address += (address.includes('?') ? '&' : '?') + 'mode=caller'
      }
      if (address === editTarget.stored) address = undefined
    }
    void updateSource(editTarget.id, {
      name: editTarget.name.trim(),
      ...(address !== undefined ? { address } : {}),
      ...(STREAM_TYPE_HAS_LATENCY[editTarget.streamType] ? { latency: parseInt(editTarget.latency, 10) || 125 } : {}),
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
        {!isPhone && (
          <Button size="sm" variant="active" onClick={() => setAddOpen(true)}>+ New Source</Button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {[...sources].sort((a, b) => a.name.localeCompare(b.name)).map((src) => {
          const inActiveProduction = activeSourceIds.has(src.id)
          const listener = isSrt(src.streamType) && !!src.address && srtDirection(src.address) === 'listener'
          const ingest = listener ? toCallerUrl(src.address, info?.stromHost) : null
          // Gateway-owned sources are recreated by the gateway on every heartbeat,
          // so Edit/Delete are locked in Studio (open-live #263, read-only Phase 1).
          const link = src.gatewayId ? gatewayBySource.get(src.id) : undefined
          const gateway = link?.gateway
          const gatewayOwned = !!src.gatewayId
          const gatewayOffline = gatewayOwned && (!gateway || gateway.health !== 'healthy')
          const uplink = link?.input?.uplink ?? null
          const locked = inActiveProduction || gatewayOwned
          const editTitle = gatewayOwned
            ? 'Managed by its gateway; edit it on the gateway box'
            : inActiveProduction ? 'Cannot edit source in an active production' : 'Edit source'
          const deleteTitle = gatewayOwned
            ? 'Managed by its gateway; the gateway recreates it each tick'
            : inActiveProduction ? 'Cannot delete source in an active production' : 'Delete source'
          return (
            <div
              key={src.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded bg-[--color-surface-3] border transition-colors ${
                locked || isPhone
                  ? 'border-[--color-border] hover:border-zinc-600 cursor-not-allowed'
                  : 'border-[--color-border] hover:border-orange-500 cursor-pointer'
              }`}
              // Phone tier: opening the edit form would expose a state-mutating
              // form, so rows are inert (glanceable status only) at <768px (#105).
              onClick={() => { if (!locked && !isPhone) openEdit(src) }}
            >
              <StatusDot color={gatewayOffline ? 'yellow' : inActiveProduction ? 'red' : 'gray'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[--color-text-primary] truncate">{src.name}</span>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted] uppercase">
                    {STREAM_TYPE_LABELS[src.streamType]}
                  </span>
                  {gatewayOwned && (
                    <span
                      className="text-xs font-mono px-1.5 py-0.5 rounded bg-indigo-900 text-indigo-200 border border-indigo-700"
                      title={gateway ? `Registered by gateway ${gateway.name}` : 'Registered by a gateway'}
                    >
                      via {gateway?.name ?? 'gateway'}
                    </span>
                  )}
                  {ingest && !gatewayOwned && <InlineCopyButton label="Ingest address" value={ingest} />}
                </div>
                {gatewayOwned && uplink ? (
                  <span className="text-xs text-[--color-text-muted] font-mono truncate block">
                    {(uplink.bitrateKbps / 1000).toFixed(1)} Mbps · {uplink.rtt_ms} ms RTT
                    {uplink.dropped > 0 && <span className="ml-1 text-yellow-400">· {uplink.dropped} dropped</span>}
                    {listener && ` · port ${listenerPort(src.address) ?? '—'}`}
                  </span>
                ) : STREAM_TYPE_HAS_ADDRESS[src.streamType] && (
                  <span className="text-xs text-[--color-text-muted] font-mono truncate block">
                    {ingest ? `sender dials ${ingest}${passphraseOf(src.address) ? ' with the passphrase' : ''}` : src.address}
                    {src.latency != null && src.latency !== 125 && (
                      <span className="ml-2 text-[--color-text-muted] opacity-60">{src.latency} ms</span>
                    )}
                  </span>
                )}
                {gatewayOffline && (
                  <span className="text-xs text-yellow-400 block mt-0.5">
                    offline gateway{gateway?.lastSeenAt ? ` — last seen ${heartbeatAge(gateway.lastSeenAt)}` : ' — never seen'}
                  </span>
                )}
              </div>
              {/* Phone tier (<768px): hide state-mutating controls (edit/delete);
                  source status stays glanceable and read-only (#105). */}
              {!isPhone && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); if (!locked) openEdit(src) }}
                    disabled={locked}
                    className="text-white hover:text-orange-500 disabled:opacity-30 disabled:cursor-not-allowed"
                    title={editTitle}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); if (!gatewayOwned) setDeleteTargetId(src.id) }}
                    disabled={locked}
                    className="text-white hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                    title={deleteTitle}
                  >
                    Delete
                  </Button>
                </>
              )}
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
              <label className={labelCls}>Name</label>
              <input
                type="text"
                value={editTarget.name}
                onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })}
                className={inputCls}
              />
            </div>
            {isSrt(editTarget.streamType) && (
              <DirectionToggle
                value={editTarget.direction}
                onChange={(direction) => { setEditTarget({ ...editTarget, direction }); setEditAddressError(null) }}
                listenerLabel={LISTENER_LABEL}
                callerLabel={CALLER_LABEL}
              />
            )}
            {editIsListener ? (
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
                    Sender dials {toCallerUrl(editTarget.stored, info?.stromHost)}{passphraseOf(editTarget.stored) ? ' with the passphrase' : ''}
                  </p>
                )}
              </>
            ) : STREAM_TYPE_HAS_ADDRESS[editTarget.streamType] && (
              <div>
                <label className={labelCls}>{isSrt(editTarget.streamType) ? "Sender's address" : 'Address'}</label>
                <input
                  type="text"
                  value={editTarget.address}
                  placeholder={isSrt(editTarget.streamType) ? 'srt://sender.example.com:9000?mode=caller' : 'https://example.com/overlay'}
                  onChange={(e) => { setEditTarget({ ...editTarget, address: e.target.value }); setEditAddressError(null) }}
                  className={inputCls}
                />
                {editAddressError && <p className="text-xs text-red-400 mt-1">{editAddressError}</p>}
              </div>
            )}
            {STREAM_TYPE_HAS_LATENCY[editTarget.streamType] && (
              <div>
                <label className={labelCls}>Latency (ms)</label>
                <input
                  type="number"
                  min={0}
                  value={editTarget.latency}
                  placeholder="125"
                  onChange={(e) => setEditTarget({ ...editTarget, latency: e.target.value })}
                  className={inputCls}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => { setEditTarget(null); setEditAddressError(null) }}>Cancel</Button>
              <Button variant="active" onClick={handleEdit} disabled={!editReady}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      <Modal open={addOpen} title="New Source" onClose={() => { resetAdd(); setAddOpen(false) }}>
        <div className="flex flex-col gap-3">
          <div>
            <label className={labelCls}>Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Camera 4 — Closeup"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Stream Type</label>
            <div className="grid grid-cols-2 gap-2">
              {CREATABLE_STREAM_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setNewStreamType(t); setNewAddress(''); setAddAddressError(null) }}
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
          {isSrt(newStreamType) && (
            <DirectionToggle
              value={newDirection}
              onChange={(d) => { setNewDirection(d); setAddAddressError(null) }}
              listenerLabel={LISTENER_LABEL}
              callerLabel={CALLER_LABEL}
            />
          )}
          {newIsListener ? (
            <ListenerFields
              mode={portMode}
              manualPort={newManualPort}
              onManualPort={setNewManualPort}
              passphrase={newPassphrase}
              onPassphrase={setNewPassphrase}
            />
          ) : STREAM_TYPE_HAS_ADDRESS[newStreamType] && (
            <div>
              <label className={labelCls}>{isSrt(newStreamType) ? "Sender's address" : 'Address'}</label>
              <input
                type="text"
                value={newAddress}
                onChange={(e) => { setNewAddress(e.target.value); setAddAddressError(null) }}
                placeholder={isSrt(newStreamType) ? 'srt://sender.example.com:9000?mode=caller' : 'https://example.com/overlay'}
                className={inputCls}
              />
              {addAddressError && <p className="text-xs text-red-400 mt-1">{addAddressError}</p>}
            </div>
          )}
          {STREAM_TYPE_HAS_LATENCY[newStreamType] && (
            <div>
              <label className={labelCls}>
                Latency <span className="normal-case opacity-60">(ms, default 125)</span>
              </label>
              <input
                type="number"
                min={20}
                max={8000}
                value={newLatency}
                placeholder="125"
                onChange={(e) => setNewLatency(e.target.value)}
                className={inputCls}
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => { resetAdd(); setAddOpen(false) }}>Cancel</Button>
            <Button variant="active" onClick={handleAdd} disabled={!addReady}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
