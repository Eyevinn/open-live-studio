import { ApiError, type InputRecordMode, type ProductionSourceAssignment } from '@/lib/api'
import { errorReason, sourceRecordErrorMessage } from '@/lib/input-recording'

/**
 * Moving source assignments between mixer pads (Setup → Production options):
 * the remove-and-shift of an input and the compaction of pad gaps on open.
 *
 * `POST .../sources` has replace semantics, so a moved source must carry its
 * `record` (OL-32) along. It is not sent with the move itself: the backend's
 * record cap counts recorded inputs on every other pad, and the source's old
 * pad still holds its `record` at that moment, so the moved input would count
 * twice and the POST could be refused with 409 `record-cap-reached`. Instead
 * every source is moved without `record`, and `record` is re-applied
 * (`PUT .../sources/:mixerInput/record`) only once its old pad has been
 * cleared or replaced. No request then needs more recorded inputs than the
 * production already had.
 */
export interface SourceMoveOps {
  assign: (assignment: ProductionSourceAssignment) => Promise<void>
  unassign: (mixerInput: string) => Promise<void>
  setRecord: (mixerInput: string, record: InputRecordMode) => Promise<unknown>
}

function pad(index: number): string { return `video_in_${index}` }

/** Pad → source after removing the input at `index` and shifting later pads down by one. */
export function shiftAssignments(assignments: Record<string, string>, index: number, slotCount: number): Record<string, string> {
  const next = { ...assignments }
  for (let i = index; i < slotCount - 1; i++) {
    const src = next[pad(i + 1)]
    if (src) next[pad(i)] = src
    else delete next[pad(i)]
  }
  delete next[pad(slotCount - 1)]
  return next
}

/**
 * Writes a remove-and-shift (`before` → `after`, from {@link shiftAssignments})
 * to the backend, one request at a time (parallel writes race on the CouchDB
 * revision), then re-applies `record` on the pads whose source came from a
 * recorded pad. `records` is the stored `record` per pad before the shift.
 * Stops the pad writes at the first failure; returns that error (or the first
 * failed `record` re-apply), null when everything was saved.
 */
export async function syncRemoveShift(
  before: Record<string, string>,
  after: Record<string, string>,
  index: number,
  slotCount: number,
  records: ReadonlyMap<string, InputRecordMode | undefined>,
  ops: SourceMoveOps,
): Promise<unknown> {
  let error: unknown = null
  const done = new Set<string>() // pads whose write (if any) completed
  const written = new Set<string>() // pads replaced or cleared: their old `record` is gone
  try {
    for (let i = index; i < slotCount; i++) {
      const p = pad(i)
      const newSrc = after[p]
      const oldSrc = before[p]
      if (newSrc && newSrc !== oldSrc) {
        await ops.assign({ mixerInput: p, sourceId: newSrc })
        written.add(p)
      } else if (!newSrc && oldSrc) {
        await ops.unassign(p)
        written.add(p)
      }
      done.add(p)
    }
  } catch (err) {
    error = err
  }

  const turnOff: string[] = []
  const turnOn: string[] = []
  for (let i = index; i < slotCount - 1; i++) {
    const p = pad(i)
    const from = pad(i + 1)
    if (!after[p] || !done.has(p)) continue
    const want = records.get(from) === 'transcode'
    const now = written.has(p) ? false : records.get(p) === 'transcode'
    if (want === now) continue
    if (!want) turnOff.push(p)
    // Only once the old pad no longer holds its `record`, so the cap is never exceeded.
    else if (written.has(from)) turnOn.push(p)
  }
  for (const [mixerInput, mode] of [...turnOff.map((p) => [p, 'off'] as const), ...turnOn.map((p) => [p, 'transcode'] as const)]) {
    try {
      await ops.setRecord(mixerInput, mode)
    } catch (err) {
      error ??= err
    }
  }
  return error
}

/**
 * Moves `sorted` (non-guest assignments in pad order) onto contiguous pads
 * from `video_in_0`, one request at a time. A source's old pad is only
 * cleared once its new pad is saved, and its `record` is re-applied after
 * that. Stops at the first failed move (a later move could otherwise replace
 * a pad that still holds the only copy of a source); returns that error (or
 * the first failed `record` re-apply), null when everything was saved.
 */
export async function compactSources(sorted: readonly ProductionSourceAssignment[], ops: SourceMoveOps): Promise<unknown> {
  let error: unknown = null
  for (const [i, s] of sorted.entries()) {
    const to = pad(i)
    if (s.mixerInput === to) continue
    try {
      await ops.assign({ mixerInput: to, sourceId: s.sourceId })
      await ops.unassign(s.mixerInput)
    } catch (err) {
      return err
    }
    if (s.record === 'transcode') {
      try {
        await ops.setRecord(to, 'transcode')
      } catch (err) {
        error ??= err
      }
    }
  }
  return error
}

/** Pad → source for the stored assignments, keeping their actual pads. */
export function assignmentsByPad(sources: readonly ProductionSourceAssignment[]): Record<string, string> {
  return Object.fromEntries(sources.map((s) => [s.mixerInput, s.sourceId]))
}

/** Shown in the Sources section when a move could not be saved completely. */
export function sourceMoveErrorMessage(err: unknown): string {
  const detail = err instanceof ApiError && errorReason(err.body)
    ? sourceRecordErrorMessage(err)
    : `Could not save the input order: ${err instanceof Error && err.message ? err.message : 'request failed'}.`
  return `${detail} The list shows what is saved now.`
}
