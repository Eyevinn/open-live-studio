/**
 * Decision returned by {@link decideAudioStreamIndex}. `send: false` means the
 * edited audio-stream index must be omitted from the source PATCH — either it is
 * invalid or it is unchanged from what the dialog loaded. `send: true` carries
 * the validated 0-based index to persist (ADR-006).
 */
export type AudioStreamIndexDecision =
  | { send: false }
  | { send: true; audioStreamIndex: number }

/**
 * Decide whether the audio-stream index typed/selected in the source edit
 * dialog should be sent to the backend.
 *
 * Mirrors the SourcesPanel "Save" rule exactly: only PATCH `audioStreamIndex`
 * when the raw input parses to a non-negative integer AND differs from the
 * value the dialog was opened with. The change check compares the raw strings
 * (not the parsed numbers) so re-saving an untouched field never emits a
 * redundant write regardless of formatting.
 *
 * This helper intentionally does not know about source type — callers still
 * gate on SRT/EFP before applying the result.
 *
 * @param raw     The index as typed/selected (the edit field's string value).
 * @param initial The index string the dialog loaded with (the stored value).
 */
export function decideAudioStreamIndex(raw: string, initial: string): AudioStreamIndexDecision {
  const parsed = Number(raw)
  const valid = raw.trim() !== '' && Number.isInteger(parsed) && parsed >= 0
  if (!valid || raw === initial) return { send: false }
  return { send: true, audioStreamIndex: parsed }
}
