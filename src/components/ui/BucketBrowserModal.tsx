import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { inputCls, labelCls } from '@/components/ui/SrtDirectionFields'
import { storageConnectionsApi } from '@/lib/api'
import { validateBucketName } from '@/lib/clipRef'
import {
  BROWSE_PAGE_SIZE,
  breadcrumb,
  browseConnectionId,
  browseErrorMessage,
  browseReducer,
  folderLabel,
  formatLastModified,
  formatSize,
  initialBrowseBucket,
  initialBrowseState,
  visibleObjects,
} from '@/lib/bucketBrowser'
import { useStorageStore } from '@/store/storage.store'

interface BucketBrowserModalProps {
  /** Picker value of the s3 form ('' is the instance default connection). */
  connectionId: string
  /** Bucket currently typed in the form; pre-fills the bucket prompt. */
  formBucket: string
  onPick: (bucket: string, key: string) => void
  onClose: () => void
}

/**
 * Read-only bucket browser for an `s3` clip reference (studio#218, OL-21b.2).
 * Lists one level of the selected connection and bucket per request through
 * `GET /api/v1/storage-connections/:id/objects` — the only request it sends —
 * and has no write controls. Picking an object hands its key and bucket back to
 * the form. Mount it only while open so its state starts fresh each time.
 */
export function BucketBrowserModal({ connectionId, formBucket, onPick, onClose }: BucketBrowserModalProps) {
  const id = browseConnectionId(connectionId)
  const connection = useStorageStore((s) => s.connections.find((c) => c.id === id))
  const presetBucket = initialBrowseBucket(connection)
  const needsBucketPrompt = presetBucket === null

  // Bucket the operator confirmed in the prompt (only used without a defaultBucket).
  const [chosenBucket, setChosenBucket] = useState<string | null>(null)
  const [bucketInput, setBucketInput] = useState(formBucket.trim())
  const [bucketError, setBucketError] = useState<string | null>(null)
  const activeBucket = needsBucketPrompt ? chosenBucket : presetBucket

  const [state, dispatch] = useReducer(browseReducer, initialBrowseState)
  // Drops responses of superseded requests (fast folder clicks, bucket change, close).
  const seq = useRef(0)

  const fetchPage = useCallback(
    async (bucket: string, prefix: string, cursor?: string) => {
      const mine = ++seq.current
      try {
        const page = await storageConnectionsApi.listObjects(id, { bucket, prefix, cursor, maxKeys: BROWSE_PAGE_SIZE })
        if (mine === seq.current) dispatch({ type: 'loaded', page })
      } catch (err) {
        if (mine === seq.current) dispatch({ type: 'failed', error: browseErrorMessage(err) })
      }
    },
    [id],
  )

  // List the bucket root whenever the bucket to browse becomes known or changes.
  useEffect(() => {
    if (!activeBucket) return
    dispatch({ type: 'open', prefix: '' })
    void fetchPage(activeBucket, '')
  }, [activeBucket, fetchPage])

  useEffect(() => () => { seq.current += 1 }, [])

  // This modal is usually stacked on another Modal, which also closes on Escape
  // via a document listener. Catch Escape first (window, capture phase) so only
  // the browser closes and the form behind it stays open.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [onClose])

  function openPrefix(prefix: string) {
    if (!activeBucket) return
    dispatch({ type: 'open', prefix })
    void fetchPage(activeBucket, prefix)
  }

  function loadMore() {
    if (!activeBucket || !state.cursor) return
    dispatch({ type: 'more' })
    void fetchPage(activeBucket, state.prefix, state.cursor)
  }

  function retry() {
    if (state.appending) loadMore()
    else openPrefix(state.prefix)
  }

  function submitBucket() {
    const err = validateBucketName(bucketInput)
    setBucketError(err)
    if (err) return
    const next = bucketInput.trim()
    if (next === chosenBucket) openPrefix('')
    else setChosenBucket(next)
  }

  const objects = visibleObjects(state.objects, state.prefix)
  const loading = state.status === 'loading'
  const firstPageLoading = loading && !state.appending
  const isEmpty = state.status === 'loaded' && state.folders.length === 0 && objects.length === 0

  return (
    <Modal
      open
      title="Browse bucket"
      onClose={onClose}
      className="max-w-2xl"
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-[--color-text-muted]">
          This list comes from open-live. Playback is fetched by Strom, so an object listed here is not
          guaranteed to be playable from Strom.
        </p>

        {needsBucketPrompt && (
          // Not a <form>: this modal renders inside the parent dialog's tree, and a
          // nested form's submit would bubble to it.
          <div className="flex flex-col gap-1">
            <label className={labelCls} htmlFor="bucket-browser-bucket">Bucket</label>
            <div className="flex gap-2">
              <input
                id="bucket-browser-bucket"
                type="text"
                value={bucketInput}
                placeholder="my-clips"
                onChange={(e) => { setBucketInput(e.target.value); setBucketError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitBucket() } }}
                className={inputCls}
              />
              <Button type="button" variant="default" onClick={submitBucket} disabled={!bucketInput.trim()}>List</Button>
            </div>
            {bucketError ? (
              <p className="text-xs text-red-400">{bucketError}</p>
            ) : !activeBucket && (
              <p className="text-xs text-[--color-text-muted]">
                This connection has no default bucket. Enter the bucket to browse.
              </p>
            )}
          </div>
        )}

        {activeBucket && (
          <>
            <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
              {breadcrumb(activeBucket, state.prefix).map((item, i, all) => (
                <span key={item.prefix} className="flex items-center gap-1">
                  {i > 0 && <span className="text-[--color-text-muted]">/</span>}
                  {i === all.length - 1 ? (
                    <span className="font-semibold text-[--color-text-primary]">{item.label}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openPrefix(item.prefix)}
                      className="text-orange-500 hover:underline cursor-pointer"
                    >
                      {item.label}
                    </button>
                  )}
                </span>
              ))}
            </nav>

            {state.status === 'error' && !state.appending && (
              <div role="alert" className="flex items-center justify-between gap-3 rounded border border-red-900 bg-red-950/40 px-3 py-2">
                <p className="text-sm text-red-300">{state.error}</p>
                <Button size="sm" variant="default" onClick={retry}>Retry</Button>
              </div>
            )}

            {firstPageLoading && <p className="text-sm text-[--color-text-muted]">Loading…</p>}

            {isEmpty && <p className="text-sm text-[--color-text-muted]">No objects here</p>}

            {(state.folders.length > 0 || objects.length > 0) && !firstPageLoading && (
              <div className="rounded border border-[var(--color-border-strong)]">
                <div className="grid grid-cols-[1fr_6rem_11rem] gap-2 px-3 py-1.5 text-xs uppercase tracking-wider text-[--color-text-muted] border-b border-[var(--color-border-strong)]">
                  <span>Name</span>
                  <span className="text-right">Size</span>
                  <span>Last modified</span>
                </div>
                <ul>
                  {state.folders.map((f) => (
                    <li key={`d:${f.prefix}`}>
                      <button
                        type="button"
                        onClick={() => openPrefix(f.prefix)}
                        className="grid w-full grid-cols-[1fr_6rem_11rem] gap-2 px-3 py-1.5 text-left text-sm hover:bg-[--color-surface-raised] cursor-pointer"
                      >
                        <span className="truncate font-medium text-[--color-text-primary]">{folderLabel(f, state.prefix)}/</span>
                        <span className="text-right text-[--color-text-muted]">Folder</span>
                        <span />
                      </button>
                    </li>
                  ))}
                  {objects.map((o) => (
                    <li key={`o:${o.key}`}>
                      <button
                        type="button"
                        title={o.key}
                        onClick={() => onPick(activeBucket, o.key)}
                        className="grid w-full grid-cols-[1fr_6rem_11rem] gap-2 px-3 py-1.5 text-left text-sm hover:bg-[--color-surface-raised] cursor-pointer"
                      >
                        <span className="truncate text-[--color-text-primary]">{o.name}</span>
                        <span className="text-right text-[--color-text-muted]">{formatSize(o.size)}</span>
                        <span className="text-[--color-text-muted]">{formatLastModified(o.lastModified)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {state.status === 'error' && state.appending && (
              <div role="alert" className="flex items-center justify-between gap-3 rounded border border-red-900 bg-red-950/40 px-3 py-2">
                <p className="text-sm text-red-300">{state.error}</p>
                <Button size="sm" variant="default" onClick={retry}>Retry</Button>
              </div>
            )}

            {state.cursor && state.status !== 'error' && (
              <div className="flex justify-center">
                <Button size="sm" variant="default" disabled={loading} onClick={loadMore}>
                  {loading ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
