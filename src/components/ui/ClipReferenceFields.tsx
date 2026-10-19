import { useEffect } from 'react'
import { inputCls, labelCls } from '@/components/ui/SrtDirectionFields'
import { CLIP_REF_LABELS, type ClipRefState, type ClipRefType } from '@/lib/clipRef'
import { DEFAULT_STORAGE_CONNECTION_ID } from '@/lib/api'
import { clipPickerConnections } from '@/lib/storageConnection'
import { useStorageStore } from '@/store/storage.store'

/**
 * Storage-connection picker for an `s3` reference (studio#217). Offers the
 * instance default plus stored connections with role `clip` or `both`. '' is
 * the default and serializes to no `connectionId`. A reference that already
 * points at a connection not in that list (deleted, or role `recording`) keeps
 * it as an extra option so editing the source does not silently drop it. The
 * "no longer exists" warning waits for the first successful list (`loaded`) so
 * it does not flash while the connections are still being fetched.
 */
function ConnectionPicker({ value, onChange }: { value: ClipRefState; onChange: (next: ClipRefState) => void }) {
  const connections = useStorageStore((s) => s.connections)
  const loadError = useStorageStore((s) => s.loadError)
  const loaded = useStorageStore((s) => s.loaded)
  const fetchAll = useStorageStore((s) => s.fetchAll)

  useEffect(() => { void fetchAll() }, [fetchAll])

  const defaultEntry = connections.find((c) => c.id === DEFAULT_STORAGE_CONNECTION_ID)
  const options = clipPickerConnections(connections)
  const current = value.connectionId
  const currentListed = !current || options.some((c) => c.id === current)
  const currentStored = connections.find((c) => c.id === current)

  function choose(id: string) {
    const picked = options.find((c) => c.id === id)
    onChange({
      ...value,
      connectionId: id,
      // Pre-fill Bucket from the connection's default bucket; still editable.
      ...(picked?.defaultBucket ? { bucket: picked.defaultBucket } : {}),
    })
  }

  return (
    <div>
      <label className={labelCls}>Storage Connection</label>
      <select value={current} onChange={(e) => choose(e.target.value)} className={inputCls}>
        <option value="">{defaultEntry ? defaultEntry.name : 'Default (instance storage)'}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>{c.name}{c.defaultBucket ? ` (${c.defaultBucket})` : ''}</option>
        ))}
        {!currentListed && (
          <option value={current}>
            {currentStored
              ? `${currentStored.name} (role: ${currentStored.role})`
              : loaded ? `Unknown connection (${current})` : `${current} (loading…)`}
          </option>
        )}
      </select>
      {loadError && (
        <p className="text-xs text-[--color-text-muted] mt-1">Could not load storage connections: {loadError}</p>
      )}
      {loaded && !currentListed && !currentStored && !loadError && (
        <p className="text-xs text-amber-400 mt-1">This connection no longer exists; cueing the clip will fail until another is chosen.</p>
      )}
    </div>
  )
}

/**
 * Clip-reference form fields: a `url` / `s3` type selector plus the variant's
 * inputs. Shared by the New Source and Edit dialogs and the Clips panel New clip
 * dialog so all build the same `ClipReference` the backend resolves (studio#148,
 * studio#217). `error` is the inline validation message surfaced under the fields.
 */
export function ClipReferenceFields({
  value,
  onChange,
  error,
}: {
  value: ClipRefState
  onChange: (next: ClipRefState) => void
  error: string | null
}) {
  return (
    <>
      <div>
        <label className={labelCls}>Reference Type</label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CLIP_REF_LABELS) as ClipRefType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChange({ ...value, type: t })}
              className={`py-2 rounded text-sm border transition-colors ${
                value.type === t
                  ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-surface-2)] border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-orange-500'
              }`}
            >
              {CLIP_REF_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      {value.type === 'url' ? (
        <div>
          <label className={labelCls}>Clip URL</label>
          <input
            type="text"
            value={value.url}
            placeholder="https://example.com/clip.mp4"
            onChange={(e) => onChange({ ...value, url: e.target.value })}
            className={inputCls}
          />
        </div>
      ) : (
        <>
          <ConnectionPicker value={value} onChange={onChange} />
          <div>
            <label className={labelCls}>Bucket</label>
            <input
              type="text"
              value={value.bucket}
              placeholder="my-clips"
              onChange={(e) => onChange({ ...value, bucket: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Object Key</label>
            <input
              type="text"
              value={value.key}
              placeholder="highlights/clip.mp4"
              onChange={(e) => onChange({ ...value, key: e.target.value })}
              className={inputCls}
            />
          </div>
        </>
      )}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </>
  )
}
