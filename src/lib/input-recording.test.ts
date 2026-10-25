import { afterEach, describe, expect, it, vi } from 'vitest'

// api.ts reads `window._env_` and the SAT auth on import; stub both so the real
// ApiError class and API client load in the node test environment.
vi.mock('./base.js', () => ({ BASE: 'http://test' }))
vi.mock('./sat.js', () => ({ authenticateWithOpenLive: vi.fn(), getApiToken: vi.fn().mockResolvedValue(null) }))
const upsertToastByTag = vi.fn()
vi.mock('../store/toast.store', () => ({ useToastStore: { getState: () => ({ upsertToastByTag }) } }))
vi.mock('../hooks/useConnectionCheck', () => ({ isInitialCheckDone: () => true }))

import { ApiError, productionsApi, type StreamType } from '@/lib/api'
import {
  RECORD_UNSUPPORTED_SOURCE,
  hasRecordedInputs,
  hasRecordingOutputAssigned,
  isRecordableSource,
  parseRecordingStateFrame,
  recordedInputSet,
  recordingOutputMissing,
  sourceRecordErrorMessage,
} from './input-recording'

const sources: Array<{ id: string; streamType: StreamType }> = [
  { id: 'cam-srt', streamType: 'srt' },
  { id: 'cam-efp', streamType: 'efp' },
  { id: 'cam-whip', streamType: 'whip' },
  { id: 'gfx-html', streamType: 'html' },
  { id: 'clip-1', streamType: 'clip' },
  { id: 'test-1', streamType: 'test1' },
]

describe('isRecordableSource', () => {
  it('allows only WHIP, SRT and EFP sources (OL-32 Q6)', () => {
    expect(isRecordableSource('cam-srt', sources)).toBe(true)
    expect(isRecordableSource('cam-efp', sources)).toBe(true)
    expect(isRecordableSource('cam-whip', sources)).toBe(true)
    expect(isRecordableSource('gfx-html', sources)).toBe(false)
    expect(isRecordableSource('clip-1', sources)).toBe(false)
    expect(isRecordableSource('test-1', sources)).toBe(false)
  })

  it('treats the virtual WHIP input as recordable and virtual test sources as not', () => {
    expect(isRecordableSource('Whip', [])).toBe(true)
    expect(isRecordableSource('__test1__', sources)).toBe(false)
    expect(isRecordableSource('__test2__', sources)).toBe(false)
  })

  it('is false for a source missing from the catalogue', () => {
    expect(isRecordableSource('gone', sources)).toBe(false)
  })
})

describe('sourceRecordErrorMessage', () => {
  it('maps record-source-unsupported (400)', () => {
    const err = new ApiError('Only WHIP, SRT and EFP sources can be recorded', 400, {
      error: 'Only WHIP, SRT and EFP sources can be recorded', statusCode: 400, reason: 'record-source-unsupported',
    })
    expect(sourceRecordErrorMessage(err)).toContain(RECORD_UNSUPPORTED_SOURCE)
  })

  it('maps record-cap-reached (409) and keeps the backend text', () => {
    const err = new ApiError('At most 4 inputs can be recorded', 409, {
      error: 'At most 4 inputs can be recorded', statusCode: 409, reason: 'record-cap-reached',
    })
    const msg = sourceRecordErrorMessage(err)
    expect(msg).toContain('maximum number of recorded inputs')
    expect(msg).toContain('At most 4 inputs can be recorded')
  })

  it('maps record-mode-unsupported (400)', () => {
    const err = new ApiError('passthrough is not supported', 400, { reason: 'record-mode-unsupported' })
    expect(sourceRecordErrorMessage(err)).toContain('recording mode is not supported')
  })

  it('explains a 404 (assignment gone) and falls back to the backend error', () => {
    expect(sourceRecordErrorMessage(new ApiError('Source assignment not found', 404, {}))).toContain('no longer assigned')
    expect(sourceRecordErrorMessage(new ApiError('Database unavailable', 503, {}))).toBe('Could not change recording: Database unavailable')
    expect(sourceRecordErrorMessage(new TypeError('Failed to fetch'))).toBe('Could not reach open-live: Failed to fetch')
  })
})

describe('parseRecordingStateFrame', () => {
  it('reads program and inputs keyed by the stored mixerInput', () => {
    const frame = parseRecordingStateFrame({
      type: 'RECORDING_STATE',
      program: true,
      inputs: [
        { mixerInput: 'video_in_0', sourceId: 'cam-srt', sourceName: 'Cam 1' },
        { mixerInput: 'video_in_3', sourceId: 'Whip', sourceName: 'Guest 1 · In 4' },
      ],
    })
    expect(frame).toEqual({
      program: true,
      inputs: [
        { mixerInput: 'video_in_0', sourceId: 'cam-srt', sourceName: 'Cam 1' },
        { mixerInput: 'video_in_3', sourceId: 'Whip', sourceName: 'Guest 1 · In 4' },
      ],
    })
  })

  it('drops malformed entries and rejects an unusable frame', () => {
    expect(parseRecordingStateFrame({ program: false, inputs: [null, 3, { sourceId: 'x' }, { mixerInput: 'video_in_1' }] }))
      .toEqual({ program: false, inputs: [{ mixerInput: 'video_in_1', sourceId: '', sourceName: '' }] })
    expect(parseRecordingStateFrame({ program: 'yes', inputs: [] })).toBeNull()
    expect(parseRecordingStateFrame({ program: true })).toBeNull()
  })
})

describe('recordedInputSet', () => {
  const active = { status: 'active', inputRecordings: [{ mixerInput: 'video_in_5' }] }

  it('marks exactly the inputs in RECORDING_STATE (#233 AC 1)', () => {
    const frame = { program: true, inputs: [
      { mixerInput: 'video_in_0', sourceId: 'a', sourceName: 'A' },
      { mixerInput: 'video_in_2', sourceId: 'b', sourceName: 'B' },
    ] }
    expect([...recordedInputSet(frame, active)].sort()).toEqual(['video_in_0', 'video_in_2'])
  })

  it('falls back to production.inputRecordings before the first frame', () => {
    expect([...recordedInputSet(null, active)]).toEqual(['video_in_5'])
  })

  it('honours the empty frame sent on deactivate', () => {
    expect(recordedInputSet({ program: false, inputs: [] }, active).size).toBe(0)
  })

  it('is empty unless the production is active', () => {
    const frame = { program: true, inputs: [{ mixerInput: 'video_in_0', sourceId: 'a', sourceName: 'A' }] }
    expect(recordedInputSet(frame, { status: 'inactive' }).size).toBe(0)
    expect(recordedInputSet(frame, undefined).size).toBe(0)
  })
})

describe('recording output checks', () => {
  const catalogue = [
    { id: 'rec', outputType: 'recording' as const },
    { id: 'srt', outputType: 'mpegtssrt' as const },
  ]

  it('detects a recording output among the assignments', () => {
    expect(hasRecordingOutputAssigned(['srt', 'rec'], catalogue)).toBe(true)
    expect(hasRecordingOutputAssigned(['srt'], catalogue)).toBe(false)
    expect(hasRecordingOutputAssigned([], catalogue)).toBe(false)
  })

  it('warns only when an input records and no recording output is assigned (#233 AC 3)', () => {
    const recorded = [{ record: 'transcode' }, {}]
    expect(hasRecordedInputs(recorded)).toBe(true)
    expect(recordingOutputMissing(recorded, ['srt'], catalogue)).toBe(true)
    expect(recordingOutputMissing(recorded, [], catalogue)).toBe(true)
    expect(recordingOutputMissing(recorded, ['rec'], catalogue)).toBe(false)
  })

  it('stays quiet for productions that record no inputs (#233 AC 4)', () => {
    expect(recordingOutputMissing([{}, { record: 'off' }], [], catalogue)).toBe(false)
  })

  it('stays quiet while the output catalogue is not loaded', () => {
    expect(recordingOutputMissing([{ record: 'transcode' }], ['rec'], [])).toBe(false)
  })
})

describe('productionsApi.setSourceRecord', () => {
  afterEach(() => { vi.unstubAllGlobals(); upsertToastByTag.mockClear() })

  it('PUTs { record } to .../sources/:mixerInput/record and returns the SourceRecordResult', async () => {
    const result = {
      mixerInput: 'video_in_2', sourceId: 'cam-srt', record: 'transcode', appliesFrom: 'next-activation',
      currentlyRecording: false, recordingOutputAssigned: false, _rev: '12-a',
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(productionsApi.setSourceRecord('prod 1', 'video_in_2', 'transcode')).resolves.toEqual(result)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://test/api/v1/productions/prod%201/sources/video_in_2/record')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ record: 'transcode' })
  })

  it('throws an ApiError carrying the reason, without a global toast', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Too many recorded inputs', statusCode: 409, reason: 'record-cap-reached' }), { status: 409 },
    )))
    const err = await productionsApi.setSourceRecord('p1', 'video_in_0', 'transcode').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).body).toMatchObject({ reason: 'record-cap-reached' })
    expect(upsertToastByTag).not.toHaveBeenCalled()
  })
})
