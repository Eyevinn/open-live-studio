import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { inputCls } from '@/components/ui/SrtDirectionFields'
import { formatSize } from '@/lib/bucketBrowser'
import {
  RECORDINGS_EMPTY_MESSAGE,
  UPLOADING_MESSAGE,
  UPLOAD_RETRY_NOTE,
  buildRecordingRows,
  canPlay,
  downloadTarget,
  finishedDeactivations,
  formatDuration,
  formatStartedAt,
  isUploading,
  playbackUnavailableMessage,
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
 * Recordings tab (studio#220, OL-21b.4). Read-only: lists recordings, plays
 * them and downloads them. No delete, rename or upload.
 */
export function RecordingsPanel({ initialProductionId = null }: Props) {
  const { recordings, productionFilter, isLoading, loadError, loaded, setProductionFilter, fetchList, fetchFresh } =
    useRecordingsStore()
  const productions = useProductionsStore((s) => s.productions)
  const pendingStatus = useProductionsStore((s) => s.pendingStatus)
  const fetchProductions = useProductionsStore((s) => s.fetchAll)
  const connections = useStorageStore((s) => s.connections)
  const fetchConnections = useStorageStore((s) => s.fetchAll)

  const [playing, setPlaying] = useState<RecordingRow | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

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

  async function handleDownload(row: RecordingRow) {
    setRowError(null)
    // Open the fallback tab synchronously (inside the click) so it is not
    // popup-blocked; it is pointed at the fresh link once that arrives.
    const fallbackTab = row.recording.downloadUrl ? null : window.open('', '_blank')
    setDownloadingId(row.recording.id)
    try {
      const fresh = await fetchFresh(row.recording.id)
      const target = downloadTarget(fresh)
      if (!target) {
        fallbackTab?.close()
        setRowError({ id: row.recording.id, message: playbackUnavailableMessage(fresh) })
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
      setRowError({ id: row.recording.id, message: recordingsErrorMessage(err) })
    } finally {
      setDownloadingId(null)
    }
  }

  const showEmpty = loaded && !loadError && rows.length === 0

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
                <th className="py-1.5 pr-3 font-medium">Production</th>
                <th className="py-1.5 pr-3 font-medium">Started</th>
                <th className="py-1.5 pr-3 font-medium">Duration</th>
                <th className="py-1.5 pr-3 font-medium">Size</th>
                <th className="py-1.5 pr-3 font-medium">Storage</th>
                <th className="py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const r = row.recording
                const playable = canPlay(r)
                return (
                  <tr key={r.id} className="border-t border-[--color-border] align-top">
                    <td className="py-1.5 pr-3 font-mono text-[--color-text-primary] break-all">
                      {row.fileName}
                      {!playable && (
                        <p className="mt-0.5 font-sans text-[--color-text-muted]">{playbackUnavailableMessage(r)}</p>
                      )}
                      {rowError?.id === r.id && (
                        <p role="alert" className="mt-0.5 font-sans text-red-400">{rowError.message}</p>
                      )}
                    </td>
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
                      <Button size="sm" variant="ghost" disabled={!playable} onClick={() => { setRowError(null); setPlaying(row) }}>
                        Play
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!playable || downloadingId === r.id}
                        onClick={() => void handleDownload(row)}
                      >
                        {downloadingId === r.id ? 'Preparing…' : 'Download'}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {playing && (
        <RecordingPlayerModal
          recording={playing.recording}
          title={`${playing.productionName} — ${formatStartedAt(playing.recording.startedAt)}`}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  )
}
