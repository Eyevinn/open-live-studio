// ─── Recording output helpers (studio#219, OL-21b.3) ─────────────────────────
// Pure helpers behind the Recording output type in the Outputs tab and the
// production output slots, kept out of the components so they are unit-tested.
//
// Storage selection is a string: '' is the instance default (the synthetic
// `default` connection, MINIO_* env) and serializes to NO `connectionId` on
// create, exactly like the clip picker. Any other value is a stored connection id.
import type { ApiOutput, ApiStorageConnection, OutputCreateInput, OutputPatchInput } from '@/lib/api'
import { ApiError, DEFAULT_STORAGE_CONNECTION_ID } from '@/lib/api'

/** Help line on a production's Recording slot (studio#216 item 16). */
export const RECORDING_SLOT_HELP =
  'Recording runs while this production is active. Adding or removing it takes effect the next time the production is activated.'

/** Why a second Recording output is refused (studio#216 item 17, open-live flow-generator). */
export const ONE_RECORDING_PER_PRODUCTION =
  'Only one Recording output is used per production: open-live records the first one assigned and ignores the rest.'

export const NO_STORAGE_AVAILABLE = 'No storage available'

export function isRecordingOutput(o: Pick<ApiOutput, 'outputType'> | undefined): boolean {
  return o?.outputType === 'recording'
}

/** Normalizes a stored `connectionId` to the selector value ('' = default). */
export function storageSelection(connectionId: string | undefined): string {
  return !connectionId || connectionId === DEFAULT_STORAGE_CONNECTION_ID ? '' : connectionId
}

/** Stored connections offered for recordings: role `recording` or `both` (not `default`). */
export function recordingPickerConnections(all: ApiStorageConnection[]): ApiStorageConnection[] {
  return all.filter((c) => c.id !== DEFAULT_STORAGE_CONNECTION_ID && (c.role === 'recording' || c.role === 'both'))
}

export interface StorageOption {
  /** Selector value: '' = default, else a stored connection id. */
  value: string
  label: string
  /** Shown but not selectable, with the reason in the label. */
  disabled?: boolean
}

export interface RecordingStorageOptions {
  options: StorageOption[]
  /** False when nothing selectable exists: show "No storage available", disable Save. */
  available: boolean
}

/**
 * Options for the recording storage selector: the default entry (only when the
 * backend lists it, i.e. the MINIO_* env is configured) followed by stored
 * connections with role `recording`/`both`. A connection without a default
 * bucket is listed disabled, because recordings upload into that bucket and the
 * backend rejects it ("Storage connection has no default bucket").
 *
 * `current` is the edited output's selection: if it is not otherwise offered
 * (deleted, role `clip`, or a default that is no longer configured) it is kept
 * as an option so the select shows what is stored instead of silently changing.
 */
export function recordingStorageOptions(all: ApiStorageConnection[], current?: string): RecordingStorageOptions {
  const options: StorageOption[] = []
  const defaultEntry = all.find((c) => c.id === DEFAULT_STORAGE_CONNECTION_ID)
  if (defaultEntry) options.push({ value: '', label: `${defaultEntry.name} (default)` })
  for (const c of recordingPickerConnections(all)) {
    options.push(
      c.defaultBucket
        ? { value: c.id, label: `${c.name} · ${c.defaultBucket}` }
        : { value: c.id, label: `${c.name} (no default bucket)`, disabled: true },
    )
  }
  const available = options.some((o) => !o.disabled)
  if (current !== undefined && !options.some((o) => o.value === current)) {
    if (current === '') {
      options.unshift({ value: '', label: 'Default (not configured on this server)' })
    } else {
      const stored = all.find((c) => c.id === current)
      options.push({ value: current, label: stored ? stored.name : `Unknown connection (${current})` })
    }
  }
  return { options, available }
}

/** Storage shown on an output row: connection name, "Default", or the dangling id. */
export function recordingStorageLabel(connectionId: string | undefined, all: ApiStorageConnection[]): string {
  const sel = storageSelection(connectionId)
  if (sel === '') return 'Default'
  const c = all.find((x) => x.id === sel)
  return c ? c.name : `Unknown connection (${sel})`
}

/** `POST` body for a new Recording output. The default sends no `connectionId`. */
export function recordingCreateInput(name: string, selection: string): OutputCreateInput {
  return { name: name.trim(), outputType: 'recording', ...(selection ? { connectionId: selection } : {}) }
}

/**
 * `PATCH` body for an edited Recording output: only changed fields. The backend
 * PATCH cannot remove a field, so re-pointing to the default sends the reserved
 * id `"default"`, which open-live resolves to the env storage everywhere.
 */
export function recordingPatchInput(
  name: string,
  original: Pick<ApiOutput, 'name' | 'connectionId'>,
  selection: string,
): OutputPatchInput {
  const patch: OutputPatchInput = {}
  const trimmed = name.trim()
  if (trimmed !== original.name) patch.name = trimmed
  if (selection !== storageSelection(original.connectionId)) {
    patch.connectionId = selection || DEFAULT_STORAGE_CONNECTION_ID
  }
  return patch
}

/**
 * Reason a production slot may not hold `candidateId`, or null. Refused when
 * the candidate is a Recording output and another slot already holds one.
 */
export function recordingSlotConflict(
  slotIds: string[],
  slotIndex: number,
  candidateId: string,
  outputs: ApiOutput[],
): string | null {
  const candidate = outputs.find((o) => o.id === candidateId)
  if (!isRecordingOutput(candidate)) return null
  const other = slotIds
    .map((id, i) => (i === slotIndex ? undefined : outputs.find((o) => o.id === id)))
    .find((o) => isRecordingOutput(o))
  return other ? `${ONE_RECORDING_PER_PRODUCTION} "${other.name}" is already assigned.` : null
}

/** Readable inline message for a failed output create/update (backend `error` first). */
export function outputSaveErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = (err.body as { issues?: { path?: (string | number)[]; message?: string }[] } | undefined)?.issues
    if (Array.isArray(issues) && issues.length > 0) {
      const detail = issues.map((i) => `${(i.path ?? []).join('.') || 'body'}: ${i.message ?? 'invalid'}`).join('; ')
      return `${err.message}: ${detail}`
    }
    return err.message
  }
  return err instanceof Error ? err.message : 'Failed to save the output'
}
