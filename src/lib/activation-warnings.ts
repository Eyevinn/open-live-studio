/**
 * Non-blocking problems the backend found while activating a production,
 * persisted as `ProductionDoc.activationWarnings` and returned on the production
 * resource (open-live spec docs/specs/audio-stream-selection.md §2.5, ADR-010).
 * Mirrors `ActivationWarning` in open-live `src/db/types.ts`.
 */
export type ActivationWarning =
  | { type: 'recording-no-audio'; message: string }
  | {
      type: 'audio-stream-not-applied'
      /** SourceDoc id. */
      sourceId: string
      /** Stored assignment key (e.g. 'video_in_3'), not the compacted Strom pad. */
      mixerInput: string
      /** Requested `audioStreamIndex`, 0-based, > 0. */
      requestedIndex: number
      /** v1 always falls back to the first stream. */
      appliedIndex: 0
      reason: 'stream-type-unsupported' | 'strom-capability-missing' | 'stream-not-present'
      /** Human text with 1-based stream numbers. */
      message: string
    }
  /**
   * Inputs set to record that this activation does not record (OL-32,
   * open-live `docs/specs/iso-input-recording.md` §2.7): no Live Recorder on
   * this Strom (program still records), no `recording` output, or over
   * RECORDING_MAX_INPUTS (`mixerInputs` lists the skipped ones).
   */
  | {
      type: 'input-recording-unavailable' | 'input-recording-no-output' | 'input-recording-capped'
      /** Stored assignment keys. */
      mixerInputs: string[]
      message: string
    }
  /** An input set to record whose source is no longer WHIP, SRT or EFP; that input is not recorded (OL-32). */
  | {
      type: 'input-recording-unsupported-source'
      mixerInput: string
      sourceId: string
      message: string
    }

/**
 * Map each mixer input of an active production to the `input-recording-*`
 * messages that say it is set to record but is not being recorded (OL-32
 * §2.7). Same rules as `audioStreamWarningsByInput`: active productions only,
 * malformed items and unknown types skipped.
 */
export function inputRecordingWarningsByInput(
  production: { status: string; activationWarnings?: readonly ActivationWarning[] } | undefined,
): Map<string, string[]> {
  const byInput = new Map<string, string[]>()
  if (production?.status !== 'active') return byInput
  const add = (mixerInput: unknown, message: string) => {
    if (typeof mixerInput !== 'string') return
    const list = byInput.get(mixerInput)
    if (list) list.push(message)
    else byInput.set(mixerInput, [message])
  }
  for (const w of production.activationWarnings ?? []) {
    if (!w || typeof w.message !== 'string') continue
    if (w.type === 'input-recording-unsupported-source') {
      add(w.mixerInput, w.message)
    } else if (
      w.type === 'input-recording-unavailable' ||
      w.type === 'input-recording-no-output' ||
      w.type === 'input-recording-capped'
    ) {
      if (!Array.isArray(w.mixerInputs)) continue
      for (const mi of w.mixerInputs) add(mi, w.message)
    }
  }
  return byInput
}

/**
 * Map each mixer input of an active production to the `audio-stream-not-applied`
 * messages raised for it (open-live#516). Only matches on `mixerInput`, so a
 * source on two inputs gets one entry per input. Returns an empty map unless the
 * production is active: warnings from the last activation must not linger on
 * the tiles after deactivation. Skips malformed items and unknown types.
 */
export function audioStreamWarningsByInput(
  production: { status: string; activationWarnings?: readonly ActivationWarning[] } | undefined,
): Map<string, string[]> {
  const byInput = new Map<string, string[]>()
  if (production?.status !== 'active') return byInput
  for (const w of production.activationWarnings ?? []) {
    if (w?.type !== 'audio-stream-not-applied') continue
    if (typeof w.mixerInput !== 'string' || typeof w.message !== 'string') continue
    const list = byInput.get(w.mixerInput)
    if (list) list.push(w.message)
    else byInput.set(w.mixerInput, [w.message])
  }
  return byInput
}
