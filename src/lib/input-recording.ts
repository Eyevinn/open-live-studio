// ─── ISO input recording (studio#233, OL-32b) ────────────────────────────────
// Pure helpers behind the per-source Record toggle, the recording indicator on
// the vision-mixer tiles and the input labels in the Recordings tab. Built
// strictly against open-live `docs/specs/iso-input-recording.md` §2 and §8,
// `docs/openapi.yaml` and `docs/controller-websocket.md` (open-live PR #573).
import { ApiError, type ApiOutput, type InputRecordingErrorReason, type InputRecordingState, type StreamType } from '@/lib/api'
import { isRecordingOutput } from '@/lib/recordingOutput'

/** Only these source types can be recorded to their own files (OL-32 Q6). */
export const RECORDABLE_STREAM_TYPES: readonly StreamType[] = ['whip', 'srt', 'efp']

/** Id of the virtual WHIP input source; it is a WHIP source and so recordable. */
const VIRTUAL_WHIP_SOURCE_ID = 'Whip'

/** `record` is read at activation (`appliesFrom: 'next-activation'`). */
export const RECORD_APPLIES_NOTE = 'Applies from the next activation.'

/** A running production keeps recording what it was activated with. */
export const RECORD_LIVE_NOTE =
  'This production is live: the change applies from the next activation. Inputs record what they were activated with until then.'

/** `recordingOutputAssigned: false` with `record: 'transcode'` (OL-32 Q1). */
export const RECORD_NO_OUTPUT_WARNING =
  'No Recording output is assigned to this production. Add one, or this input is not recorded when the production is activated.'

/** Toggle disabled for test, HTML and clip sources. */
export const RECORD_UNSUPPORTED_SOURCE = 'Only WHIP, SRT and EFP sources can be recorded.'

const RECORD_REASON_TEXT: Record<InputRecordingErrorReason, string> = {
  'record-mode-unsupported': 'This recording mode is not supported.',
  'record-source-unsupported': RECORD_UNSUPPORTED_SOURCE,
  'record-cap-reached': 'The maximum number of recorded inputs for this production is reached.',
}

/**
 * Whether a source assigned on `sourceId` can be recorded. The virtual `Whip`
 * source is WHIP; virtual test sources and catalogue sources of another type
 * (or missing from the catalogue) are not.
 */
export function isRecordableSource(
  sourceId: string,
  sources: ReadonlyArray<{ id: string; streamType: StreamType }>,
): boolean {
  if (sourceId === VIRTUAL_WHIP_SOURCE_ID) return true
  const type = sources.find((s) => s.id === sourceId)?.streamType
  return type !== undefined && RECORDABLE_STREAM_TYPES.includes(type)
}

export function errorReason(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'reason' in body) {
    const reason = (body as { reason: unknown }).reason
    return typeof reason === 'string' ? reason : undefined
  }
  return undefined
}

/**
 * Inline message for a failed `PUT .../sources/:mixerInput/record`. A known
 * `reason` gets a fixed line plus the backend `error` (which names the cap for
 * `record-cap-reached`); 404 says the assignment is gone.
 */
export function sourceRecordErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const reason = errorReason(err.body)
    if (reason && reason in RECORD_REASON_TEXT) {
      const text = RECORD_REASON_TEXT[reason as InputRecordingErrorReason]
      return err.message && err.message !== text ? `${text} ${err.message}` : text
    }
    if (err.status === 404) return 'This input is no longer assigned. Reopen the production and try again.'
    return `Could not change recording: ${err.message || `HTTP ${err.status}`}`
  }
  if (err instanceof Error && err.message) return `Could not reach open-live: ${err.message}`
  return 'Could not change recording'
}

/** `RECORDING_STATE` WS frame (OL-32 §2.8). */
export interface RecordingStateFrame {
  program: boolean
  inputs: Array<Pick<InputRecordingState, 'mixerInput' | 'sourceId' | 'sourceName'>>
}

/** Validates a `RECORDING_STATE` frame; malformed input entries are dropped. Returns null when unusable. */
export function parseRecordingStateFrame(msg: Record<string, unknown>): RecordingStateFrame | null {
  if (typeof msg['program'] !== 'boolean' || !Array.isArray(msg['inputs'])) return null
  const inputs: RecordingStateFrame['inputs'] = []
  for (const item of msg['inputs'] as unknown[]) {
    if (!item || typeof item !== 'object') continue
    const { mixerInput, sourceId, sourceName } = item as Record<string, unknown>
    if (typeof mixerInput !== 'string') continue
    inputs.push({
      mixerInput,
      sourceId: typeof sourceId === 'string' ? sourceId : '',
      sourceName: typeof sourceName === 'string' ? sourceName : '',
    })
  }
  return { program: msg['program'] as boolean, inputs }
}

/**
 * Stored mixer inputs the running activation records, for the tile indicator.
 * The live `RECORDING_STATE` frame wins; before it arrives the production's
 * `inputRecordings` stands in. Empty unless the production is active.
 */
export function recordedInputSet(
  frame: RecordingStateFrame | null,
  production: { status: string; inputRecordings?: ReadonlyArray<{ mixerInput: string }> } | undefined,
): Set<string> {
  if (production?.status !== 'active') return new Set()
  const list = frame ? frame.inputs : (production.inputRecordings ?? [])
  return new Set(list.map((i) => i.mixerInput).filter((mi) => typeof mi === 'string'))
}

/** Whether any assignment is set to record. */
export function hasRecordedInputs(sources: ReadonlyArray<{ record?: string }>): boolean {
  return sources.some((s) => s.record === 'transcode')
}

/**
 * Whether the production has a `recording` output among its assignments. Used
 * to warn before activation that inputs set to record will not be recorded
 * (`input-recording-no-output`, #233 AC 3).
 */
export function hasRecordingOutputAssigned(
  outputIds: readonly string[],
  catalogue: ReadonlyArray<Pick<ApiOutput, 'id' | 'outputType'>>,
): boolean {
  return outputIds.some((id) => isRecordingOutput(catalogue.find((o) => o.id === id)))
}

/**
 * Whether to warn that inputs set to record will not be recorded because no
 * Recording output is assigned (before activation). Stays quiet while the
 * output catalogue is not loaded yet, so assigned outputs cannot be told apart.
 */
export function recordingOutputMissing(
  sources: ReadonlyArray<{ record?: string }>,
  outputIds: readonly string[],
  catalogue: ReadonlyArray<Pick<ApiOutput, 'id' | 'outputType'>>,
): boolean {
  if (!hasRecordedInputs(sources)) return false
  if (outputIds.length > 0 && catalogue.length === 0) return false
  return !hasRecordingOutputAssigned(outputIds, catalogue)
}
