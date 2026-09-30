import { useState } from 'react'
import type { RtmpPlatform } from '@/lib/api'
import { inputCls, labelCls } from '@/components/ui/SrtDirectionFields'

/**
 * RTMP multi-destination setup fields (open-live-studio#143, backend epic
 * open-live#319 / spec `docs/specs/rtmp-multi-destination.md`).
 *
 * Credential-handling contract this UI MUST honour (spec §Studio UI scope,
 * studio#10 HIGH/CVSS 7.5 anti-pattern):
 *  - the stream key is entered in a masked (password) field;
 *  - it is sent ONLY on create/patch and is NEVER rendered back from a GET —
 *    the backend returns `streamKeySet: boolean`, never the key. The optional
 *    show/hide toggle reveals only the operator's own in-progress input, never a
 *    stored credential round-tripped from the server;
 *  - for named presets Studio never constructs or displays an RTMP URL — the
 *    backend resolves `ingestUrl` from a static table. Only `custom` collects a
 *    raw `rtmp(s)://` URL.
 */

export const RTMP_PLATFORMS: readonly RtmpPlatform[] = ['youtube', 'twitch', 'facebook', 'custom']

export const RTMP_PLATFORM_LABELS: Record<RtmpPlatform, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  facebook: 'Facebook',
  custom: 'Custom RTMP',
}

/** Max stream-key length the backend accepts (`STREAM_KEY_MAX`, open-live rtmp.ts). */
const STREAM_KEY_MAX = 512

/**
 * Client-side mirror of the backend `validateStreamKey` (open-live `lib/rtmp.ts`)
 * so an obviously bad key is caught before the round trip. The backend remains
 * the source of truth (returns 400) — this only sharpens the inline UX. Returns
 * a human message, or null when the key is acceptable.
 */
export function streamKeyError(key: string): string | null {
  if (key.length === 0) return null // emptiness is handled by the caller's "required" gating
  if (key.length > STREAM_KEY_MAX) return `Stream key is too long (max ${STREAM_KEY_MAX} characters)`
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(key)) return 'Stream key must not contain spaces or line breaks'
  if (key.startsWith('encv1:')) return 'Stream key must not begin with "encv1:"'
  return null
}

/** Whether a `custom` destination needs its ingest URL filled in before Save. */
export function customUrlMissing(platform: RtmpPlatform, customUrl: string): boolean {
  return platform === 'custom' && !customUrl.trim()
}

function PlatformPicker({ value, onChange }: { value: RtmpPlatform; onChange: (p: RtmpPlatform) => void }) {
  return (
    <div>
      <label className={labelCls}>Platform</label>
      <div className="grid grid-cols-2 gap-2">
        {RTMP_PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`py-2 rounded text-sm border transition-colors ${
              value === p
                ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                : 'bg-[var(--color-surface-2)] border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-orange-500'
            }`}
          >
            {RTMP_PLATFORM_LABELS[p]}
          </button>
        ))}
      </div>
    </div>
  )
}

interface StreamKeyFieldProps {
  value: string
  onChange: (v: string) => void
  /** Edit mode: whether a key is already stored server-side (from `streamKeySet`). */
  keyStored?: boolean
  /** Edit mode: the operator asked to clear the stored key. */
  cleared?: boolean
  onCleared?: (v: boolean) => void
}

function StreamKeyField({ value, onChange, keyStored, cleared, onCleared }: StreamKeyFieldProps) {
  const [show, setShow] = useState(false)
  const editable = !cleared
  const error = editable ? streamKeyError(value) : null
  const placeholder = keyStored ? 'Key set — leave blank to keep it' : 'Paste your platform stream key'
  return (
    <div>
      <label className={labelCls}>
        Stream key
        {keyStored !== undefined && (
          <span className="normal-case opacity-70 ml-1">
            {keyStored ? '(a key is stored)' : '(no key stored)'}
          </span>
        )}
      </label>
      <div className="flex gap-2">
        <input
          // Masked credential input — a bearer token for the operator's channel.
          type={show ? 'text' : 'password'}
          value={value}
          disabled={!editable}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={editable ? placeholder : 'Key will be cleared on save'}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} flex-1 disabled:opacity-50 disabled:cursor-not-allowed`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          disabled={!editable}
          className="px-3 rounded text-xs border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-orange-500 disabled:opacity-40 disabled:cursor-not-allowed"
          title={show ? 'Hide stream key' : 'Show stream key'}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      {keyStored && onCleared && (
        <label className="flex items-center gap-2 mt-2 text-xs text-[--color-text-muted] cursor-pointer">
          <input type="checkbox" checked={!!cleared} onChange={(e) => onCleared(e.target.checked)} />
          Clear the stored key (the destination will have no key until you set a new one)
        </label>
      )}
      {!keyStored && (
        <p className="text-xs text-[--color-text-muted] mt-1">
          Stored encrypted on the server and never shown again — you can replace it later.
        </p>
      )}
    </div>
  )
}

export interface RtmpFieldsProps {
  platform: RtmpPlatform
  onPlatform: (p: RtmpPlatform) => void
  customUrl: string
  onCustomUrl: (v: string) => void
  streamKey: string
  onStreamKey: (v: string) => void
  /** Edit mode only: whether a key is already stored (from the API `streamKeySet`). */
  keyStored?: boolean
  /** Edit mode only: operator asked to clear the stored key. */
  clearKey?: boolean
  onClearKey?: (v: boolean) => void
  /** Edit mode only: the resolved preset ingest URL to show read-only (never for entry). */
  resolvedIngestUrl?: string
}

/**
 * The full RTMP destination form body: platform picker, a custom-only ingest URL
 * field, and the masked stream-key field. Shared by the add and edit modals in
 * `OutputsPanel`, mirroring how `SrtDirectionFields` factors out the SRT body.
 */
export function RtmpFields({
  platform, onPlatform, customUrl, onCustomUrl, streamKey, onStreamKey,
  keyStored, clearKey, onClearKey, resolvedIngestUrl,
}: RtmpFieldsProps) {
  return (
    <>
      <PlatformPicker value={platform} onChange={onPlatform} />
      {platform === 'custom' ? (
        <div>
          <label className={labelCls}>Ingest URL</label>
          <input
            type="text"
            value={customUrl}
            onChange={(e) => onCustomUrl(e.target.value)}
            placeholder="rtmps://example.com/live"
            className={inputCls}
          />
          <p className="text-xs text-[--color-text-muted] mt-1">
            The platform&apos;s RTMP or RTMPS ingest URL, without the stream key.
          </p>
        </div>
      ) : (
        resolvedIngestUrl && (
          <div>
            <label className={labelCls}>Ingest URL</label>
            <p className="text-xs text-[--color-text-muted] font-mono break-all">{resolvedIngestUrl}</p>
          </div>
        )
      )}
      <StreamKeyField
        value={streamKey}
        onChange={onStreamKey}
        keyStored={keyStored}
        cleared={clearKey}
        onCleared={onClearKey}
      />
    </>
  )
}
