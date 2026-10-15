import { inputCls, labelCls } from '@/components/ui/SrtDirectionFields'
import { CLIP_REF_LABELS, type ClipRefState, type ClipRefType } from '@/lib/clipRef'

/**
 * Clip-reference form fields: a `url` / `s3` type selector plus the variant's
 * inputs. Shared by the New Source and Edit dialogs so both build the same
 * `ClipReference` the backend resolves (studio#148). `error` is the inline
 * validation message surfaced under the fields.
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
