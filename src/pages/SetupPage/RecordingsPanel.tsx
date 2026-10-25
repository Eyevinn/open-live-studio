import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { inputCls } from '@/components/ui/SrtDirectionFields'
import { formatSize } from '@/lib/bucketBrowser'
import {
  DELETE_WARNING,
  RECORDINGS_EMPTY_MESSAGE,
  UPLOADING_MESSAGE,
  UPLOAD_RETRY_NOTE,
  buildRecordingRows,
  canPlay,
  downloadTarget,
  finishedDeactivations,
  formatDuration,
  formatStartedAt,
  groupRecordingRows,
  hasInputRecordings,
  isInputRecording,
  isUploading,
  NO_ACTIVATION_LABEL,
  recordingInputOptions,
  playbackUnavailableMessage,
  recordingDeleteErrorMessage,
  recordingsErrorMessage,
  uploadBanner,
  uploadBannerHeadline,
  type RecordingRow,
} from '@/lib/recordings'
import { useRecordingsStore } from '@/store/recordings.store'
import { useProductionsStore } from '@/store/productions.store'
import { useStorageStore } from '@/store/storage.store'
import { RecordingPlayerModal } from './RecordingPlayerModal'

interface Props {
  /** Production to filter by when the tab is opened from a production row. */
  initialProductionId?: string | null
}

/**
 * Recordings tab (studio#220, OL-21b.4; studio#229, OL-30b). Lists recordings,
 * plays them, downloads them and deletes them one at a time after a
 * confirmation (`DELETE /api/v1/recordings/:id`, open-live #550). A failed
 * delete keeps the row and shows the reason in the row's error line. No
 * rename, upload, bulk delete or undo.
 *
 * Input recordings (studio#233, OL-32): when the list holds any, rows are
 * grouped by activation (program first, then each input, labelled by source
 * name and guest label) and can be filtered by kind and by input. A list
 * without input recordings renders exactly as before.
 */
export function RecordingsPanel({ initialProductionId = null }: Props) {
  const {
    recordings, productionFilter, isLoading, loadError, loaded, kindFilter, inputFilter,
    setProductionFilter, setKindFilter, setInputFilter, fetchList, fetchFresh, deleteRecording,
  } = useRecordingsStore()
  const productions = useProductionsStore((s) => s.productions)
  const pendingStatus = useProductionsStore((s) => s.pendingStatus)
  const fetchProductions = useProductionsStore((s) => s.fetchAll)
  const connections = useStorageStore((s) => s.connections)
  const fetchConnections = useStorageStore((s) => s.fetchAll)

  const [playing, setPlaying] = useState<RecordingRow | null>(null)
  /** Per-row error line, keyed by recording id. */
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  /** Row whose Delete confirmation is open. */
  const [confirmDelete, setConfirmDelete] = useState<RecordingRow | null>(null)
  /** Recordings with a delete request in flight. */
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * Inputs seen in any list for the current production filter, so the Input
   * filter keeps offering them while the list is narrowed to one of them.
   */
  const [knownInputs, setKnownInputs] = useState<{ scope: string | null; options: ReadonlyMap<string, string> }>(
    () => ({ scope: null, options: new Map() }),
  )
  useEffect(() => {
    setKnownInputs((prev) => {
      const base = prev.scope === productionFilter ? prev.options : new Map<string, string>()
      const found = recordingInputOptions(recordings)
      if (prev.scope === productionFilter && found.every((o) => base.get(o.mixerInput) === o.label)) return prev
      const next = new Map(base)
      for (const o of found) next.set(o.mixerInput, o.label)
      return { scope: productionFilter, options: next }
    })
  }, [recordings, productionFilter])
  const inputOptions = knownInputs.scope === productionFilter ? knownInputs.options : new Map<string, string>()

  useEffect(() => {
    void fetchProductions()
    void fetchConnections()
  }, [fetchProductions, fetchConnections])

  useEffect(() => {
    void setProductionFilter(initialProductionId)
  }, [initialProductionId, setProductionFilter])

  // Refresh the list (and the upload outcome on the production) when a
  // deactivate started in this browser finishes.
  const prevPending = useRef(pendingStatus)
  useEffect(() => {
    const finished = finishedDeactivations(prevPending.current, pendingStatus, productionFilter)
    prevPending.current = pendingStatus
    if (finished.length > 0) {
      void fetchList()
      void fetchProductions()
    }
  }, [pendingStatus, productionFilter, fetchList, fetchProductions])

  const rows = useMemo(
    () => buildRecordingRows(recordings, productions, connections),
    [recordings, productions, connections],
  )
  const selectedProduction = productionFilter ? productions.find((p) => p.id === productionFilter) : undefined
  const banner = selectedProduction ? uploadBanner(selectedProduction.lastRecordingUpload) : null
  const uploading = isUploading(pendingStatus, productionFilter)
  const sortedProductions = useMemo(
    () => [...productions].sort((a, b) => a.name.localeCompare(b.name)),
    [productions],
  )

  /** Sets (or, with `null`, clears) one row's error; other rows keep theirs. */
  function setRowError(id: string, message: string | null) {
    setRowErrors((prev) => {
      if (message === null && !prev.has(id)) return prev
      const next = new Map(prev)
      if (message === null) next.delete(id)
      else next.set(id, message)
      return next
    })
  }

  async function handleDownload(row: RecordingRow) {
    setRowError(row.recording.id, null)
    // Open the fallback tab synchronously (inside the click) so it is not
    // popup-blocked; it is pointed at the fresh link once that arrives.
    const fallbackTab = row.recording.downloadUrl ? null : window.open('', '_blank')
    setDownloadingId(row.recording.id)
    try {
      const fresh = await fetchFresh(row.recording.id)
      const target = downloadTarget(fresh)
      if (!target) {
        fallbackTab?.close()
        setRowError(row.recording.id, playbackUnavailableMessage(fresh))
        return
      }
      if (target.newTab) {
        if (fallbackTab) {
          fallbackTab.opener = null
          fallbackTab.location.href = target.url
        } else {
          window.open(target.url, '_blank', 'noopener')
        }
      } else {
        fallbackTab?.close()
        // `downloadUrl` is signed with `Content-Disposition: attachment`, so
        // navigating to it saves the file and leaves this page in place.
        window.location.assign(target.url)
      }
    } catch (err) {
      fallbackTab?.close()
      setRowError(row.recording.id, recordingsErrorMessage(err))
    } finally {
      setDownloadingId(null)
    }
  }

  async function handleDelete(row: RecordingRow) {
    const id = row.recording.id
    setConfirmDelete(null)
    setRowError(id, null)
    setDeletingIds((prev) => new Set(prev).add(id))
    try {
      await deleteRecording(id)
    } catch (err) {
      setRowError(id, recordingDeleteErrorMessage(err))
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const showEmpty = loaded && !loadError && rows.length === 0
  // Program-only lists keep the flat table (#233 AC 4).
  const grouped = hasInputRecordings(recordings)
  const groups = useMemo(() => (grouped ? groupRecordingRows(rows) : []), [grouped, rows])
  const showInputFilters = inputOptions.size > 0 || kindFilter !== null || inputFilter !== null
  const sortedInputOptions = [...inputOptions.entries()]

  function renderRow(row: RecordingRow) {
    const r = row.recording
    const playable = canPlay(r)
    const deleting = deletingIds.has(r.id)
    const rowError = rowErrors.get(r.id)
    return (
      <tr key={r.id} className="border-t border-[--color-border] align-top">
        <td className="py-1.5 pr-3 font-mono text-[--color-text-primary] break-all">
          {row.fileName}
          {!playable && (
            <p className="mt-0.5 font-sans text-[--color-text-muted]">{playbackUnavailableMessage(r)}</p>
          )}
          {rowError && (
            <p role="alert" className="mt-0.5 font-sans text-red-400">{rowError}</p>
          )}
        </td>
        {grouped && (
          <td className={`py-1.5 pr-3 ${isInputRecording(r) ? 'text-[--color-text-primary]' : 'text-[--color-text-muted]'}`}>
            {row.sourceLabel}
            {r.partIndex !== undefined && <span className="ml-1 font-mono text-[--color-text-muted]">#{r.partIndex + 1}</span>}
          </td>
        )}
        <td className={`py-1.5 pr-3 ${row.productionExists ? 'text-[--color-text-primary]' : 'text-[--color-text-muted] italic'}`}>
          {row.productionName}
        </td>
        <td className="py-1.5 pr-3 text-[--color-text-muted] whitespace-nowrap">{formatStartedAt(r.startedAt)}</td>
        <td className="py-1.5 pr-3 font-mono text-[--color-text-muted]">{formatDuration(r.durationMs)}</td>
        <td className="py-1.5 pr-3 font-mono text-[--color-text-muted] whitespace-nowrap">
          {r.sizeBytes !== undefined ? formatSize(r.sizeBytes) : '—'}
        </td>
        <td className="py-1.5 pr-3 text-[--color-text-muted]">{row.storage}</td>
        <td className="py-1.5 whitespace-nowrap text-right">
          <Button size="sm" variant="ghost" disabled={!playable || deleting} onClick={() => { setRowError(r.id, null); setPlaying(row) }}>
            Play
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!playable || deleting || downloadingId === r.id}
            onClick={() => void handleDownload(row)}
          >
            {downloadingId === r.id ? 'Preparing…' : 'Download'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="hover:text-red-400"
            disabled={deleting || downloadingId === r.id}
            aria-busy={deleting || undefined}
            onClick={() => { setRowError(r.id, null); setConfirmDelete(row) }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </td>
      </tr>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-[--color-text-muted] font-mono">
          {rows.length} {rows.length === 1 ? 'recording' : 'recordings'}
        </span>
        {isLoading && <span className="text-xs text-[--color-accent]">Refreshing…</span>}
        <div className="flex-1" />
        <label className="text-xs text-[--color-text-muted]" htmlFor="recordings-production-filter">Production</label>
        <select
          id="recordings-production-filter"
          value={productionFilter ?? ''}
          onChange={(e) => void setProductionFilter(e.target.value || null)}
          className={`${inputCls} w-56 py-1`}
        >
          <option value="">All productions</option>
          {sortedProductions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          {productionFilter && !selectedProduction && (
            <option value={productionFilter}>Deleted production ({productionFilter})</option>
          )}
        </select>
        {showInputFilters && (
          <>
            <label className="text-xs text-[--color-text-muted]" htmlFor="recordings-kind-filter">Files</label>
            <select
              id="recordings-kind-filter"
              value={kindFilter ?? ''}
              onChange={(e) => void setKindFilter(e.target.value === 'program' || e.target.value === 'input' ? e.target.value : null)}
              className={`${inputCls} w-32 py-1`}
            >
              <option value="">Program and inputs</option>
              <option value="program">Program</option>
              <option value="input">Inputs</option>
            </select>
          </>
        )}
        {showInputFilters && productionFilter !== null && kindFilter !== 'program' && (
          <>
            <label className="text-xs text-[--color-text-muted]" htmlFor="recordings-input-filter">Input</label>
            <select
              id="recordings-input-filter"
              value={inputFilter ?? ''}
              onChange={(e) => void setInputFilter(e.target.value || null)}
              className={`${inputCls} w-48 py-1`}
            >
              <option value="">All inputs</option>
              {sortedInputOptions.map(([mi, label]) => (
                <option key={mi} value={mi}>{label}</option>
              ))}
              {inputFilter && !inputOptions.has(inputFilter) && <option value={inputFilter}>{inputFilter}</option>}
            </select>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => void fetchList()} disabled={isLoading}>Refresh</Button>
      </div>

      {/* Upload in progress (deactivate in flight in this browser) */}
      {uploading && (
        <div role="status" className="rounded border border-[--color-border] bg-[--color-surface-3] px-3 py-2 text-sm text-[--color-text-primary]">
          {UPLOADING_MESSAGE}
        </div>
      )}

      {/* Upload failure for the selected production */}
      {banner && !uploading && (
        <div role="alert" className="flex flex-col gap-1 rounded border border-amber-600 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          <p className="font-semibold">{uploadBannerHeadline(banner)}</p>
          <p>{banner.reason}</p>
          <p className="text-xs text-amber-300">{UPLOAD_RETRY_NOTE}</p>
        </div>
      )}

      {/* List error (e.g. backend 503). The empty message is never shown with it. */}
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded border border-red-900 bg-red-950/40 px-3 py-2">
          <p className="text-sm text-red-300">
            {loadError.message}
            {loadError.status === 503 && ' Recordings cannot be listed until the database is available again.'}
          </p>
          <Button size="sm" variant="ghost" onClick={() => void fetchList()} disabled={isLoading}>Retry</Button>
        </div>
      )}

      {showEmpty && (
        <div className="rounded border border-dashed border-[--color-border] px-4 py-8 text-center text-sm text-[--color-text-muted]">
          {RECORDINGS_EMPTY_MESSAGE}
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded border border-[--color-border] bg-[--color-surface-3] px-4 py-2">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-[--color-text-muted] uppercase tracking-wider">
                <th className="py-1.5 pr-3 font-medium">File</th>
                {grouped && <th className="py-1.5 pr-3 font-medium">Source</th>}
                <th className="py-1.5 pr-3 font-medium">Production</th>
                <th className="py-1.5 pr-3 font-medium">Started</th>
                <th className="py-1.5 pr-3 font-medium">Duration</th>
                <th className="py-1.5 pr-3 font-medium">Size</th>
                <th className="py-1.5 pr-3 font-medium">Storage</th>
                <th className="py-1.5 font-medium" />
              </tr>
            </thead>
            {grouped
              ? groups.map((g) => (
                  <tbody key={g.key} aria-label={`Activation ${g.activationId ?? 'unknown'}`}>
                    <tr className="border-t-2 border-[--color-border-strong]">
                      <th colSpan={8} scope="rowgroup" className="pt-3 pb-1 font-medium normal-case tracking-normal text-[--color-text-primary]">
                        {g.activationId ? `${g.productionName} — activation of ${formatStartedAt(g.startedAt)}` : `${g.productionName} — ${NO_ACTIVATION_LABEL}`}
                        <span className="ml-2 font-normal text-[--color-text-muted]">
                          {g.rows.length} {g.rows.length === 1 ? 'file' : 'files'}
                        </span>
                      </th>
                    </tr>
                    {g.rows.map(renderRow)}
                  </tbody>
                ))
              : <tbody>{rows.map(renderRow)}</tbody>}
          </table>
        </div>
      )}

      {confirmDelete && (
        <Modal open title="Delete recording" onClose={() => setConfirmDelete(null)} className="max-w-sm">
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-[--color-text-muted]">Production</dt>
              <dd className="text-[--color-text-primary] break-all">{confirmDelete.productionName}</dd>
              {isInputRecording(confirmDelete.recording) && (
                <>
                  <dt className="text-[--color-text-muted]">Source</dt>
                  <dd className="text-[--color-text-primary] break-all">{confirmDelete.sourceLabel}</dd>
                </>
              )}
              <dt className="text-[--color-text-muted]">Started</dt>
              <dd className="text-[--color-text-primary]">{formatStartedAt(confirmDelete.recording.startedAt)}</dd>
              <dt className="text-[--color-text-muted]">Size</dt>
              <dd className="text-[--color-text-primary] font-mono">
                {confirmDelete.recording.sizeBytes !== undefined ? formatSize(confirmDelete.recording.sizeBytes) : 'unknown'}
              </dd>
            </dl>
            <p className="text-sm text-[--color-text-primary]">{DELETE_WARNING}</p>
            <div className="flex justify-end gap-2">
              {/* Cancel is the default action: it has focus when the dialog opens. */}
              <Button variant="ghost" autoFocus onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void handleDelete(confirmDelete)}>Delete</Button>
            </div>
          </div>
        </Modal>
      )}

      {playing && (
        <RecordingPlayerModal
          recording={playing.recording}
          title={isInputRecording(playing.recording)
            ? `${playing.productionName} · ${playing.sourceLabel} — ${formatStartedAt(playing.recording.startedAt)}`
            : `${playing.productionName} — ${formatStartedAt(playing.recording.startedAt)}`}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  )
}
