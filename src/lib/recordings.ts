// ─── Recordings tab (studio#220, OL-21b.4) ───────────────────────────────────
// Pure helpers behind RecordingsPanel and the player modal, kept out of the
// components so sorting, the production join, labels and error mapping are
// unit-testable. The only write is Delete (studio#229), whose error mapping is
// `recordingDeleteErrorMessage`.
import {
  ApiError,
  type ApiRecording,
  type RecordingDeleteReason,
  type ApiStorageConnection,
  type PlaybackUnavailableReason,
  type RecordingUploadReason,
  type RecordingUploadSummary,
} from '@/lib/api'
import { recordingStorageLabel } from '@/lib/recordingOutput'

export const RECORDINGS_EMPTY_MESSAGE =
  'No recordings yet. A recording is saved when a production with a Recording output is deactivated.'

export const UPLOAD_RETRY_NOTE =
  'The files stay on the Strom server and are tried again the next time this production is activated with a Recording output and then deactivated.'

export const UPLOADING_MESSAGE = 'Uploading recordings. They appear here when deactivation finishes.'

export const DELETED_PRODUCTION = 'Deleted production'

/** Basename of the object key (whatever its prefix scheme). */
export function recordingFileName(key: string): string {
  const base = key.split('/').filter(Boolean).pop()
  return base || key
}

function startedAtMs(r: Pick<ApiRecording, 'startedAt'>): number {
  const t = Date.parse(r.startedAt)
  return Number.isNaN(t) ? -Infinity : t
}

/**
 * Newest first by `startedAt` (the backend returns recordings unsorted). Ties
 * and unparsable dates fall back to the key so the order is stable.
 */
export function sortRecordings<T extends Pick<ApiRecording, 'startedAt' | 'key'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const d = startedAtMs(b) - startedAtMs(a)
    if (d !== 0 && !Number.isNaN(d)) return d
    return a.key.localeCompare(b.key)
  })
}

/** "M:SS" / "H:MM:SS" for `durationMs`, or "unknown" when the backend could not read it. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return 'unknown'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Locale date/time for `startedAt`, or '—' when invalid. */
export function formatStartedAt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

// ─── Program vs input recordings (studio#233, OL-32) ─────────────────────────

/** Label of the program recording in the Source column. */
export const PROGRAM_LABEL = 'Program'

/** Group heading for parts recorded before `activationId` existed. */
export const NO_ACTIVATION_LABEL = 'Earlier recordings (no activation id)'

/**
 * `kind` of a recording: absent and `program` read as `program` (the backend
 * backfills older docs, OL-32 §3.4); any value added later is kept as sent.
 */
export function recordingKind(r: Pick<ApiRecording, 'kind'>): string {
  return r.kind === undefined ? 'program' : r.kind
}

export function isInputRecording(r: Pick<ApiRecording, 'kind'>): boolean {
  return r.kind === 'input'
}

/** "Input N" (1-based) for a stored mixerInput such as `video_in_2`, else the raw value. */
export function mixerInputLabel(mixerInput: string): string {
  const m = /^video_in_(\d{1,2})$/.exec(mixerInput)
  return m ? `Input ${parseInt(m[1]!, 10) + 1}` : mixerInput
}

/**
 * Source column: "Program" for program parts; for an input, the multiviewer
 * label at activation (`sourceName`), with the WHIP guest's name
 * (`guestLabel`) when there is one.
 */
export function recordingSourceLabel(
  r: Pick<ApiRecording, 'kind' | 'sourceName' | 'mixerInput' | 'guestLabel'>,
): string {
  const kind = recordingKind(r)
  if (kind === 'program') return PROGRAM_LABEL
  if (kind !== 'input') return kind
  const base = r.sourceName?.trim() || (r.mixerInput ? mixerInputLabel(r.mixerInput) : 'Input')
  const guest = r.guestLabel?.trim()
  return guest && !base.includes(guest) ? `${base} (${guest})` : base
}

/** True when the list holds at least one input recording; the tab then groups by activation. */
export function hasInputRecordings(list: ReadonlyArray<Pick<ApiRecording, 'kind'>>): boolean {
  return list.some(isInputRecording)
}

/** Input-filter options: each recorded `mixerInput` with its latest label, in pad order. */
export function recordingInputOptions(
  list: ReadonlyArray<Pick<ApiRecording, 'kind' | 'mixerInput' | 'sourceName' | 'guestLabel' | 'startedAt'>>,
): Array<{ mixerInput: string; label: string }> {
  const latest = new Map<string, { label: string; at: number }>()
  for (const r of list) {
    if (!isInputRecording(r) || !r.mixerInput) continue
    const at = startedAtMs(r)
    const prev = latest.get(r.mixerInput)
    if (!prev || at >= prev.at) latest.set(r.mixerInput, { label: r.sourceName?.trim() || mixerInputLabel(r.mixerInput), at })
  }
  return [...latest.entries()]
    .sort(([a], [b]) => padNumber(a) - padNumber(b))
    .map(([mixerInput, { label }]) => ({ mixerInput, label: `${label} · ${mixerInputLabel(mixerInput)}` }))
}

function padNumber(mixerInput: string | undefined): number {
  const m = mixerInput ? /(\d+)$/.exec(mixerInput) : null
  return m ? parseInt(m[1]!, 10) : Number.MAX_SAFE_INTEGER
}

/** One row of the Recordings table, joined with production and storage names. */
export interface RecordingRow {
  recording: ApiRecording
  fileName: string
  productionName: string
  /** False when the production no longer exists ("Deleted production"). */
  productionExists: boolean
  storage: string
  /** "Program", or the input's source name (and guest label). */
  sourceLabel: string
}

/** One activation's files: program parts first, then each input's parts. */
export interface RecordingGroup {
  /** `<productionId>/<activationId>`, or `<productionId>/` for parts without an activation id. */
  key: string
  activationId?: string
  productionName: string
  productionExists: boolean
  /** Earliest `startedAt` in the group (ISO), the activation's start. */
  startedAt: string
  rows: RecordingRow[]
}

/**
 * Groups rows by `activationId` (OL-32 §8), newest activation first. Within a
 * group: program before inputs, inputs by pad number, then `partIndex`, then
 * `startedAt`. Parts without an activation id share one group per production,
 * listed after the activations.
 */
export function groupRecordingRows(rows: readonly RecordingRow[]): RecordingGroup[] {
  const groups = new Map<string, RecordingGroup>()
  for (const row of rows) {
    const r = row.recording
    const key = `${r.productionId}/${r.activationId ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        ...(r.activationId ? { activationId: r.activationId } : {}),
        productionName: row.productionName,
        productionExists: row.productionExists,
        startedAt: r.startedAt,
        rows: [],
      }
      groups.set(key, g)
    }
    if (startedAtMs(r) < startedAtMs({ startedAt: g.startedAt })) g.startedAt = r.startedAt
    g.rows.push(row)
  }
  const kindRank = (r: ApiRecording) => (isInputRecording(r) ? 1 : 0)
  for (const g of groups.values()) {
    g.rows.sort((a, b) => {
      const ra = a.recording, rb = b.recording
      return (
        kindRank(ra) - kindRank(rb) ||
        padNumber(ra.mixerInput) - padNumber(rb.mixerInput) ||
        (ra.partIndex ?? 0) - (rb.partIndex ?? 0) ||
        startedAtMs(ra) - startedAtMs(rb) ||
        ra.key.localeCompare(rb.key)
      )
    })
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.activationId !== !b.activationId) return a.activationId ? -1 : 1
    const d = startedAtMs({ startedAt: b.startedAt }) - startedAtMs({ startedAt: a.startedAt })
    return d !== 0 && !Number.isNaN(d) ? d : a.key.localeCompare(b.key)
  })
}

/**
 * Joins sorted recordings with the productions store (name, or "Deleted
 * production" with the id) and the storage connections ("Default" when the
 * recording has no `connectionId`).
 */
export function buildRecordingRows(
  recordings: readonly ApiRecording[],
  productions: ReadonlyArray<{ id: string; name: string }>,
  connections: ApiStorageConnection[],
): RecordingRow[] {
  const names = new Map(productions.map((p) => [p.id, p.name]))
  return sortRecordings(recordings).map((r) => {
    const name = names.get(r.productionId)
    return {
      recording: r,
      fileName: recordingFileName(r.key),
      productionName: name ?? `${DELETED_PRODUCTION} (${r.productionId})`,
      productionExists: name !== undefined,
      storage: recordingStorageLabel(r.connectionId, connections),
      sourceLabel: recordingSourceLabel(r),
    }
  })
}

const PLAYBACK_UNAVAILABLE_TEXT: Record<PlaybackUnavailableReason, string> = {
  'connection-missing': 'its storage connection no longer exists',
  'connection-no-bucket': 'its storage connection has no bucket',
  'storage-not-configured': 'the instance default storage is not configured',
  'bucket-mismatch': 'it is in a bucket other than the instance default bucket',
  'signing-failed': 'the playback link could not be signed',
}

/** "Playback unavailable: <reason>" for a recording without `playbackUrl`. */
export function playbackUnavailableMessage(r: Pick<ApiRecording, 'playbackUnavailable'>): string {
  const reason = r.playbackUnavailable
  const text = reason ? (PLAYBACK_UNAVAILABLE_TEXT[reason] ?? reason) : 'no playback link was returned'
  return `Playback unavailable: ${text}`
}

/** Whether Play and Download are offered for a recording. */
export function canPlay(r: Pick<ApiRecording, 'playbackUrl'>): boolean {
  return !!r.playbackUrl
}

/** URL Download opens: `downloadUrl` (saves as attachment), else `playbackUrl` in a new tab. */
export function downloadTarget(r: Pick<ApiRecording, 'downloadUrl' | 'playbackUrl'>): { url: string; newTab: boolean } | null {
  if (r.downloadUrl) return { url: r.downloadUrl, newTab: false }
  if (r.playbackUrl) return { url: r.playbackUrl, newTab: true }
  return null
}

/** Readable message for a failed list or fetch. The backend `error` (e.g. 503 "Database unavailable") is shown as sent. */
export function recordingsErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.message) return err.message
    return `Request failed (HTTP ${err.status})`
  }
  if (err instanceof Error && err.message) return `Could not reach open-live: ${err.message}`
  return 'Could not load recordings'
}

// ─── Delete (studio#229, open-live #550) ─────────────────────────────────────

/** Warning in the Delete confirmation dialog. */
export const DELETE_WARNING = 'This removes the file from storage. It cannot be undone.'

const DELETE_REASON_TEXT: Record<RecordingDeleteReason, string> = {
  'connection-missing': 'Cannot delete: the recording\'s storage connection no longer exists. Nothing was deleted.',
  'connection-no-bucket': 'Cannot delete: the recording\'s storage connection has no bucket. Nothing was deleted.',
  'storage-not-configured': 'Cannot delete: the instance default storage is not configured. Nothing was deleted.',
  'bucket-mismatch': 'Cannot delete: the recording is in a bucket other than the instance default bucket. Nothing was deleted.',
  'storage-denied': 'The storage key is not allowed to delete this file. The recording was kept.',
  'storage-failed': 'The storage could not delete the file. The recording was kept. Try again.',
}

function deleteReason(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'reason' in body) {
    const reason = (body as { reason: unknown }).reason
    return typeof reason === 'string' ? reason : undefined
  }
  return undefined
}

/**
 * Row message for a failed `DELETE /api/v1/recordings/:id`. A known `reason`
 * (409, 502) gets a fixed line; an unknown one falls back to the backend
 * `error`. 404 and 503 get a hint on what to do next.
 */
export function recordingDeleteErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const reason = deleteReason(err.body)
    if (reason && reason in DELETE_REASON_TEXT) return DELETE_REASON_TEXT[reason as RecordingDeleteReason]
    if (err.status === 404) return 'Recording not found. It may already have been deleted. Refresh the list.'
    if (err.status === 503) {
      return 'The database is unavailable, so the recording could not be removed from the list. Try Delete again.'
    }
    const base = err.message || `Request failed (HTTP ${err.status})`
    return `Delete failed: ${base}${reason ? ` (${reason})` : ''}`
  }
  if (err instanceof Error && err.message) return `Could not reach open-live: ${err.message}`
  return 'Delete failed'
}

const UPLOAD_REASON_TEXT: Record<RecordingUploadReason, string> = {
  'no-storage-target': 'No storage target is configured for the recording output.',
  'connection-not-found': 'The recording output\'s storage connection was not found.',
  'connection-no-bucket': 'The recording output\'s storage connection has no default bucket.',
  'auth-error': 'The object store rejected the credentials or permission.',
  'upload-error': 'The recording upload failed.',
}

export interface UploadBanner {
  failedCount: number
  reason: string
}

/**
 * Banner for `lastRecordingUpload`, or null when the last upload succeeded (or
 * there is none). Shown when files failed or a `reason` was reported. The
 * reason text is the backend `message`, else a line for the `reason` code,
 * else the first failed file's error.
 */
export function uploadBanner(summary: RecordingUploadSummary | undefined): UploadBanner | null {
  if (!summary) return null
  const failed = Array.isArray(summary.failed) ? summary.failed : []
  if (failed.length === 0 && !summary.reason) return null
  const reason =
    summary.message?.trim() ||
    (summary.reason ? UPLOAD_REASON_TEXT[summary.reason] ?? summary.reason : '') ||
    failed[0]?.error ||
    'The recording upload did not complete.'
  return { failedCount: failed.length, reason }
}

/** "N file(s) failed to upload." headline for the banner. */
export function uploadBannerHeadline(b: UploadBanner): string {
  if (b.failedCount === 0) return 'Recordings were not uploaded.'
  return `${b.failedCount} recording ${b.failedCount === 1 ? 'file' : 'files'} failed to upload.`
}

// ─── Player error states ─────────────────────────────────────────────────────

export type PlaybackErrorKind = 'expired-or-denied' | 'unreachable' | 'unsupported'

/** Result of probing the playback URL after the video element failed. */
export type ProbeResult =
  | { kind: 'unreachable' }
  /** Host answered but the response is opaque (CORS); status unknown. */
  | { kind: 'reachable' }
  | { kind: 'status'; status: number }

/** `MediaError.MEDIA_ERR_DECODE`: the file was fetched but could not be decoded. */
export const MEDIA_ERR_DECODE = 3

/**
 * Whether a presigned S3 URL (SigV4 query auth) has passed `X-Amz-Date` +
 * `X-Amz-Expires`. Returns false when the URL carries no such parameters.
 */
export function isPresignExpired(url: string, now: number = Date.now()): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const date = parsed.searchParams.get('X-Amz-Date')
  const expires = Number(parsed.searchParams.get('X-Amz-Expires'))
  const m = date?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (!m || !parsed.searchParams.has('X-Amz-Expires') || !Number.isFinite(expires)) return false
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number]
  const signedAt = Date.UTC(y, mo - 1, d, h, mi, s)
  return now >= signedAt + expires * 1000
}

/** True when an https page would load an http media URL (blocked as mixed content). */
export function isMixedContent(url: string, pageProtocol: string): boolean {
  try {
    return pageProtocol === 'https:' && new URL(url).protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Probes a playback URL after `<video>` failed, to tell the causes apart. A
 * `no-cors` request rejects only when the host cannot be reached; a `cors`
 * range request then tries to read the status (it rejects when the bucket has
 * no CORS rule, in which case only "reachable" is known).
 */
export async function probePlaybackUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  try {
    await fetchImpl(url, { method: 'GET', mode: 'no-cors', headers: { Range: 'bytes=0-0' } })
  } catch {
    return { kind: 'unreachable' }
  }
  try {
    const res = await fetchImpl(url, { method: 'GET', mode: 'cors', headers: { Range: 'bytes=0-0' } })
    return { kind: 'status', status: res.status }
  } catch {
    return { kind: 'reachable' }
  }
}

/**
 * Classifies a `<video>` load failure:
 *  - link expired (by its own expiry) or the store answered 401/403 → expired-or-denied;
 *  - mixed content or the probe could not reach the host → unreachable;
 *  - the store served the file (2xx) or the media failed to decode → unsupported;
 *  - otherwise (opaque reachable host, or another status) → expired-or-denied,
 *    the cause a fresh link fixes.
 */
export function classifyPlaybackError(input: {
  expired: boolean
  mixedContent: boolean
  probe: ProbeResult
  mediaErrorCode?: number
}): PlaybackErrorKind {
  if (input.expired) return 'expired-or-denied'
  if (input.mixedContent) return 'unreachable'
  const { probe } = input
  if (probe.kind === 'unreachable') return 'unreachable'
  if (probe.kind === 'status') {
    if (probe.status === 401 || probe.status === 403) return 'expired-or-denied'
    if (probe.status >= 200 && probe.status < 300) return 'unsupported'
  }
  if (input.mediaErrorCode === MEDIA_ERR_DECODE) return 'unsupported'
  return 'expired-or-denied'
}

/** Readable text for each player error state. */
export function playbackErrorMessage(kind: PlaybackErrorKind, pageProtocol: string): string {
  switch (kind) {
    case 'expired-or-denied':
      return 'The playback link has expired or the storage denied access (403). Reload the link to try again.'
    case 'unreachable':
      return pageProtocol === 'https:'
        ? 'The storage host is not reachable from this browser. It must be reachable from the browser and use https, because Studio is served over https.'
        : 'The storage host is not reachable from this browser. It must be reachable from the browser, not only from the server.'
    case 'unsupported':
      return 'This browser cannot play the recording file (unsupported format). Try Download and play it locally.'
  }
}

/**
 * Production ids whose deactivate finished between two `pendingStatus`
 * snapshots, restricted to `scope` (the filtered production, or all when null).
 * The Recordings tab refreshes when this is non-empty.
 */
export function finishedDeactivations(
  prev: Record<string, 'activate' | 'deactivate'>,
  next: Record<string, 'activate' | 'deactivate'>,
  scope: string | null,
): string[] {
  return Object.keys(prev).filter(
    (id) => prev[id] === 'deactivate' && next[id] !== 'deactivate' && (scope === null || scope === id),
  )
}

/** Whether a deactivate is in flight for the scope (the filtered production, or any when null). */
export function isUploading(pending: Record<string, 'activate' | 'deactivate'>, scope: string | null): boolean {
  if (scope !== null) return pending[scope] === 'deactivate'
  return Object.values(pending).includes('deactivate')
}
