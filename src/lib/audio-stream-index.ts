import type { StreamType } from '@/lib/api'

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
 * This helper intentionally does not know about source type — callers go
 * through {@link audioStreamIndexPatch}, which gates on
 * {@link supportsAudioStreamSelection} first.
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

/**
 * Whether the backend applies a chosen audio stream for this source type.
 * Only MPEG-TS/SRT does: for EFP the backend's flow generator reports
 * `stream-type-unsupported` and always uses the first audio stream
 * (open-live `src/lib/flow-generator.ts`, OL-45). Kept separate from the
 * SRT address/listener check, which still covers EFP.
 */
export function supportsAudioStreamSelection(t: StreamType): boolean {
  return t === 'srt'
}

/** Read-only note shown in place of the Audio stream control for EFP sources. */
export const EFP_AUDIO_STREAM_NOTE = 'EFP sources always use the first audio stream.'

/** Extra note for an EFP source that still has a stored index > 0 from before OL-45. */
export function efpIgnoredAudioStreamNote(storedIndex: number): string {
  return `A previously saved stream ${storedIndex} is ignored; saving clears it.`
}

/**
 * The `audioStreamIndex` part of the source-edit PATCH.
 *
 * - SRT: the {@link decideAudioStreamIndex} result.
 * - EFP: never a chosen index. A stale stored index > 0 is cleared to 0 (the
 *   backend accepts 0 for EFP) so the stored value matches what is applied.
 * - Every other type: nothing.
 */
export function audioStreamIndexPatch(
  streamType: StreamType,
  raw: string,
  initial: string,
): { audioStreamIndex?: number } {
  if (supportsAudioStreamSelection(streamType)) {
    const decision = decideAudioStreamIndex(raw, initial)
    return decision.send ? { audioStreamIndex: decision.audioStreamIndex } : {}
  }
  if (streamType === 'efp' && Number(initial) > 0) return { audioStreamIndex: 0 }
  return {}
}

/** Inline error shown in New Source when the Audio stream input is not a non-negative integer. */
export const NEW_AUDIO_STREAM_INDEX_ERROR = 'Audio stream must be a whole number, 0 or greater.'

/**
 * Result of {@link newSourceAudioStreamIndex}: either the `audioStreamIndex`
 * part of the create body, or an inline error that blocks Add.
 */
export type NewSourceAudioStreamIndexResult =
  | { ok: true; body: { audioStreamIndex?: number } }
  | { ok: false; error: string }

/**
 * The `audioStreamIndex` part of the New Source create body (studio#244).
 *
 * - Types without audio stream selection (see {@link supportsAudioStreamSelection}):
 *   never sent — the backend rejects it for whip/html/clip.
 * - Empty or `0`: nothing sent; absent means 0 (ADR-006).
 * - An integer > 0: sent.
 * - Anything else (negative, fractional, non-numeric): an error that blocks Add.
 *
 * @param streamType The stream type selected in the New Source dialog.
 * @param raw        The Audio stream field's string value.
 */
export function newSourceAudioStreamIndex(streamType: StreamType, raw: string): NewSourceAudioStreamIndexResult {
  if (!supportsAudioStreamSelection(streamType)) return { ok: true, body: {} }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, body: {} }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 0) return { ok: false, error: NEW_AUDIO_STREAM_INDEX_ERROR }
  return { ok: true, body: parsed > 0 ? { audioStreamIndex: parsed } : {} }
}
