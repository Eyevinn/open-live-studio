// @vitest-environment jsdom
/**
 * Remove-and-shift and on-open compaction of source assignments, against a
 * fake backend that applies open-live's record cap the way
 * `checkInputRecordable` does (open-live `src/routes/productions.ts`): a
 * `record: 'transcode'` write is refused with 409 `record-cap-reached` when
 * the recorded inputs on every *other* pad already fill the cap.
 */
import { describe, expect, it } from 'vitest'
import { ApiError, type InputRecordMode, type ProductionSourceAssignment } from '@/lib/api'
import {
  assignmentsByPad, compactSources, shiftAssignments, sourceMoveErrorMessage, syncRemoveShift, type SourceMoveOps,
} from './source-moves'

const CAP = 4

function fakeBackend(initial: ProductionSourceAssignment[], opts: { failAssignTo?: string } = {}) {
  let sources = initial.map((s) => ({ ...s }))
  const refusals: string[] = []
  const requests: string[] = []
  let maxRecorded = 0
  const recorded = () => sources.filter((s) => s.record === 'transcode').length
  const track = () => { maxRecorded = Math.max(maxRecorded, recorded()) }
  function checkCap(mixerInput: string) {
    const others = sources.filter((s) => s.record === 'transcode' && s.mixerInput !== mixerInput).length
    if (others + 1 > CAP) {
      refusals.push(mixerInput)
      throw new ApiError(`At most ${CAP} inputs can be recorded per production (RECORDING_MAX_INPUTS)`, 409, {
        error: 'cap', statusCode: 409, reason: 'record-cap-reached',
      })
    }
  }
  const ops: SourceMoveOps = {
    assign: async (a) => {
      requests.push(`POST ${a.mixerInput} ${a.sourceId}${a.record ? ` ${a.record}` : ''}`)
      if (a.mixerInput === opts.failAssignTo) throw new ApiError('Database unavailable', 503)
      if (a.record === 'transcode') checkCap(a.mixerInput)
      const next: ProductionSourceAssignment = { sourceId: a.sourceId, mixerInput: a.mixerInput, ...(a.record === 'transcode' ? { record: 'transcode' as const } : {}) }
      sources = [...sources.filter((s) => s.mixerInput !== a.mixerInput), next]
      track()
    },
    unassign: async (mixerInput) => {
      requests.push(`DELETE ${mixerInput}`)
      sources = sources.filter((s) => s.mixerInput !== mixerInput)
    },
    setRecord: async (mixerInput: string, record: InputRecordMode) => {
      requests.push(`PUT ${mixerInput} ${record}`)
      const current = sources.find((s) => s.mixerInput === mixerInput)
      if (!current) throw new ApiError('Source assignment not found', 404)
      if (record === 'transcode') checkCap(mixerInput)
      sources = sources.map((s) => {
        if (s.mixerInput !== mixerInput) return s
        const rest: ProductionSourceAssignment = { sourceId: s.sourceId, mixerInput: s.mixerInput }
        return record === 'transcode' ? { ...rest, record } : rest
      })
      track()
    },
  }
  return {
    ops, refusals, requests,
    get maxRecorded() { return maxRecorded },
    /** pad → `sourceId` or `sourceId+rec`, sorted by pad. */
    state: () => Object.fromEntries([...sources]
      .sort((a, b) => a.mixerInput.localeCompare(b.mixerInput))
      .map((s) => [s.mixerInput, s.record === 'transcode' ? `${s.sourceId}+rec` : s.sourceId])),
  }
}

const rec = (mixerInput: string, sourceId: string): ProductionSourceAssignment => ({ mixerInput, sourceId, record: 'transcode' })
const off = (mixerInput: string, sourceId: string): ProductionSourceAssignment => ({ mixerInput, sourceId })
const records = (sources: ProductionSourceAssignment[]) => new Map(sources.map((s) => [s.mixerInput, s.record]))

async function removeAt(stored: ProductionSourceAssignment[], index: number, slotCount: number, backend: ReturnType<typeof fakeBackend>) {
  const before = assignmentsByPad(stored)
  const after = shiftAssignments(before, index, slotCount)
  return syncRemoveShift(before, after, index, slotCount, records(stored), backend.ops)
}

describe('shiftAssignments', () => {
  it('moves later pads down by one and clears the last', () => {
    expect(shiftAssignments({ video_in_0: 'a', video_in_1: 'b', video_in_3: 'd' }, 0, 4))
      .toEqual({ video_in_0: 'b', video_in_2: 'd' })
  })
})

describe('syncRemoveShift: record carry-over (OL-32)', () => {
  it('removes an unrecorded pad while the cap is full of recorded later pads; moved sources keep record', async () => {
    const stored = [off('video_in_0', 'A'), rec('video_in_1', 'B'), rec('video_in_2', 'C'), rec('video_in_3', 'D'), rec('video_in_4', 'E')]
    const backend = fakeBackend(stored)
    const err = await removeAt(stored, 0, 5, backend)
    expect(err).toBeNull()
    expect(backend.refusals).toEqual([])
    expect(backend.maxRecorded).toBeLessThanOrEqual(CAP)
    expect(backend.state()).toEqual({ video_in_0: 'B+rec', video_in_1: 'C+rec', video_in_2: 'D+rec', video_in_3: 'E+rec' })
    // No move carries `record`: it is re-applied once the old pads are cleared.
    expect(backend.requests.filter((r) => r.startsWith('POST')).every((r) => !r.includes('transcode'))).toBe(true)
  })

  it('keeps an unrecorded source unrecorded and a recorded one recorded when removing in the middle', async () => {
    const stored = [rec('video_in_0', 'A'), off('video_in_1', 'B'), off('video_in_2', 'C'), rec('video_in_3', 'D')]
    const backend = fakeBackend(stored)
    expect(await removeAt(stored, 1, 4, backend)).toBeNull()
    expect(backend.state()).toEqual({ video_in_0: 'A+rec', video_in_1: 'C', video_in_2: 'D+rec' })
  })

  it('stops at a failed move, returns the error and does not record a source whose old pad still records', async () => {
    const stored = [off('video_in_0', 'A'), rec('video_in_1', 'B'), rec('video_in_2', 'C'), rec('video_in_3', 'D'), rec('video_in_4', 'E')]
    const backend = fakeBackend(stored, { failAssignTo: 'video_in_1' })
    const err = await removeAt(stored, 0, 5, backend)
    expect(err).toBeInstanceOf(ApiError)
    expect(backend.refusals).toEqual([])
    expect(backend.maxRecorded).toBeLessThanOrEqual(CAP)
    // B moved to pad 0 but pad 1 was never replaced: B stays recorded on pad 1 only.
    expect(backend.state()).toEqual({ video_in_0: 'B', video_in_1: 'B+rec', video_in_2: 'C+rec', video_in_3: 'D+rec', video_in_4: 'E+rec' })
  })
})

describe('compactSources: record carry-over (OL-32)', () => {
  it('closes a gap while the cap is full; the moved source keeps record and is never dropped', async () => {
    const stored = [rec('video_in_0', 'A'), rec('video_in_1', 'B'), rec('video_in_2', 'C'), rec('video_in_4', 'E')]
    const backend = fakeBackend(stored)
    expect(await compactSources(stored, backend.ops)).toBeNull()
    expect(backend.refusals).toEqual([])
    expect(backend.maxRecorded).toBeLessThanOrEqual(CAP)
    expect(backend.state()).toEqual({ video_in_0: 'A+rec', video_in_1: 'B+rec', video_in_2: 'C+rec', video_in_3: 'E+rec' })
    expect(backend.requests).toEqual(['POST video_in_3 E', 'DELETE video_in_4', 'PUT video_in_3 transcode'])
  })

  it('does not delete the old pad when the POST to the new pad failed, and stops', async () => {
    const stored = [off('video_in_0', 'A'), rec('video_in_2', 'C'), off('video_in_5', 'F')]
    const backend = fakeBackend(stored, { failAssignTo: 'video_in_1' })
    const err = await compactSources(stored, backend.ops)
    expect(err).toBeInstanceOf(ApiError)
    expect(backend.state()).toEqual({ video_in_0: 'A', video_in_2: 'C+rec', video_in_5: 'F' })
    expect(backend.requests).toEqual(['POST video_in_1 C'])
  })

  it('moves unrecorded sources without any record request', async () => {
    const stored = [off('video_in_1', 'A'), off('video_in_3', 'B')]
    const backend = fakeBackend(stored)
    expect(await compactSources(stored, backend.ops)).toBeNull()
    expect(backend.state()).toEqual({ video_in_0: 'A', video_in_1: 'B' })
    expect(backend.requests.some((r) => r.startsWith('PUT'))).toBe(false)
  })
})

describe('sourceMoveErrorMessage', () => {
  it('explains a record refusal and a plain failure', () => {
    const cap = new ApiError('At most 4 inputs can be recorded', 409, { reason: 'record-cap-reached' })
    expect(sourceMoveErrorMessage(cap)).toContain('At most 4 inputs can be recorded')
    expect(sourceMoveErrorMessage(new ApiError('Database unavailable', 503))).toBe(
      'Could not save the input order: Database unavailable. The list shows what is saved now.',
    )
  })
})
