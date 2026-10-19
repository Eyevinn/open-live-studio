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
