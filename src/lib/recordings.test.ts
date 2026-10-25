import { afterEach, describe, expect, it, vi } from 'vitest'

// api.ts reads `window._env_` and the SAT auth on import; stub both so the real
// ApiError class and API client can be loaded in the node test environment.
vi.mock('./base.js', () => ({ BASE: 'http://test' }))
vi.mock('./sat.js', () => ({ authenticateWithOpenLive: vi.fn(), getApiToken: vi.fn().mockResolvedValue(null) }))
// A quiet request must never reach the global toast.
const upsertToastByTag = vi.fn()
vi.mock('../store/toast.store', () => ({ useToastStore: { getState: () => ({ upsertToastByTag }) } }))
vi.mock('../hooks/useConnectionCheck', () => ({ isInitialCheckDone: () => true }))

import { ApiError, recordingsApi, type ApiRecording, type ApiStorageConnection } from './api'
import {
  RECORDINGS_EMPTY_MESSAGE,
  buildRecordingRows,
  canPlay,
  classifyPlaybackError,
  downloadTarget,
  finishedDeactivations,
  formatDuration,
  groupRecordingRows,
  hasInputRecordings,
  isMixedContent,
  isPresignExpired,
  isUploading,
  playbackErrorMessage,
  playbackUnavailableMessage,
  probePlaybackUrl,
  recordingDeleteErrorMessage,
  recordingFileName,
  recordingInputOptions,
  recordingKind,
  recordingSourceLabel,
  recordingsErrorMessage,
  sortRecordings,
  uploadBanner,
  uploadBannerHeadline,
} from './recordings'

function rec(overrides: Partial<ApiRecording> = {}): ApiRecording {
  return {
    id: 'recording-1',
    productionId: 'prod-1',
    bucket: 'recordings',
    key: 'prod-1/recording_a.mp4',
    startedAt: '2026-10-19T10:00:00.000Z',
    createdAt: '2026-10-19T10:05:00.000Z',
    updatedAt: '2026-10-19T10:05:00.000Z',
    playbackUrl: 'https://s3.example.com/a.mp4',
    downloadUrl: 'https://s3.example.com/a.mp4?response-content-disposition=attachment',
    ...overrides,
  }
}

function conn(overrides: Partial<ApiStorageConnection> = {}): ApiStorageConnection {
  return {
    id: 'stconn-1',
    name: 'Customer archive',
    endpoint: 's3.example.com',
    region: 'us-east-1',
    useSsl: true,
    role: 'recording',
    accessKey: 'AK',
    secretKeySet: true,
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    ...overrides,
  }
}

describe('recordingFileName', () => {
  it('is the basename of the key, whatever the prefix', () => {
    expect(recordingFileName('recording_2026.mp4')).toBe('recording_2026.mp4')
    expect(recordingFileName('prod-1/prod-1_2026.mp4')).toBe('prod-1_2026.mp4')
    expect(recordingFileName('a/b/c.mp4')).toBe('c.mp4')
  })
})

describe('sortRecordings', () => {
  it('sorts newest first by startedAt and puts unparsable dates last', () => {
    const sorted = sortRecordings([
      rec({ id: 'a', key: 'a', startedAt: '2026-10-18T00:00:00Z' }),
      rec({ id: 'bad', key: 'bad', startedAt: 'not-a-date' }),
      rec({ id: 'c', key: 'c', startedAt: '2026-10-19T09:00:00Z' }),
    ])
    expect(sorted.map((r) => r.id)).toEqual(['c', 'a', 'bad'])
  })

  it('does not mutate the input', () => {
    const input = [rec({ id: 'a', startedAt: '2026-10-18T00:00:00Z' }), rec({ id: 'b', startedAt: '2026-10-19T00:00:00Z' })]
    sortRecordings(input)
    expect(input.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('formatDuration', () => {
  it('formats durationMs and says "unknown" when absent', () => {
    expect(formatDuration(undefined)).toBe('unknown')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })
})

describe('buildRecordingRows', () => {
  const productions = [{ id: 'prod-1', name: 'Evening News' }]

  it('joins production names and storage names, newest first', () => {
    const rows = buildRecordingRows(
      [
        rec({ id: 'old', startedAt: '2026-10-18T10:00:00Z' }),
        rec({ id: 'new', startedAt: '2026-10-19T10:00:00Z', connectionId: 'stconn-1' }),
      ],
      productions,
      [conn()],
    )
    expect(rows.map((r) => r.recording.id)).toEqual(['new', 'old'])
    expect(rows[0]).toMatchObject({ productionName: 'Evening News', productionExists: true, storage: 'Customer archive', fileName: 'recording_a.mp4' })
    expect(rows[1]?.storage).toBe('Default')
  })

  it('labels a recording of a deleted production with its id', () => {
    const [row] = buildRecordingRows([rec({ productionId: 'gone' })], productions, [])
    expect(row?.productionName).toBe('Deleted production (gone)')
    expect(row?.productionExists).toBe(false)
  })

  it('treats connectionId "default" as the default storage', () => {
    const [row] = buildRecordingRows([rec({ connectionId: 'default' })], productions, [])
    expect(row?.storage).toBe('Default')
  })
})

describe('playback availability', () => {
  it('a row without playbackUrl shows the reason and cannot play or download', () => {
    const r = rec({ playbackUrl: undefined, downloadUrl: undefined, playbackUnavailable: 'connection-missing' })
    expect(canPlay(r)).toBe(false)
    expect(downloadTarget(r)).toBeNull()
    expect(playbackUnavailableMessage(r)).toBe('Playback unavailable: its storage connection no longer exists')
  })

  it('each backend reason has its own text', () => {
    const reasons = ['connection-missing', 'connection-no-bucket', 'storage-not-configured', 'bucket-mismatch', 'signing-failed'] as const
    const texts = new Set(reasons.map((reason) => playbackUnavailableMessage({ playbackUnavailable: reason })))
    expect(texts.size).toBe(reasons.length)
  })

  it('download uses downloadUrl, else opens playbackUrl in a new tab', () => {
    expect(downloadTarget(rec())).toEqual({ url: 'https://s3.example.com/a.mp4?response-content-disposition=attachment', newTab: false })
    expect(downloadTarget(rec({ downloadUrl: undefined }))).toEqual({ url: 'https://s3.example.com/a.mp4', newTab: true })
  })
})

describe('recordingsErrorMessage', () => {
  it('shows the backend message (e.g. 503) as sent', () => {
    expect(recordingsErrorMessage(new ApiError('Database unavailable', 503))).toBe('Database unavailable')
  })

  it('falls back to the status when the backend sent no message', () => {
    expect(recordingsErrorMessage(new ApiError('', 500))).toBe('Request failed (HTTP 500)')
  })

  it('names a network failure', () => {
    expect(recordingsErrorMessage(new TypeError('Failed to fetch'))).toBe('Could not reach open-live: Failed to fetch')
  })

  it('the empty message is the one from the issue', () => {
    expect(RECORDINGS_EMPTY_MESSAGE).toBe('No recordings yet. A recording is saved when a production with a Recording output is deactivated.')
  })
})

describe('uploadBanner', () => {
  it('is null when there is no summary or the upload succeeded', () => {
    expect(uploadBanner(undefined)).toBeNull()
    expect(uploadBanner({ finishedAt: '2026-10-19T10:00:00Z', uploaded: 2, failed: [] })).toBeNull()
  })

  it('shows the failure count and the backend message for an auth error', () => {
    const b = uploadBanner({
      finishedAt: '2026-10-19T10:00:00Z',
      uploaded: 0,
      failed: [{ file: 'a.mp4', error: 'AccessDenied' }],
      reason: 'auth-error',
      message: 'The object store rejected the credentials or permission (AccessDenied); the upload stopped and the remaining files stay on Strom.',
    })
    expect(b).toEqual({ failedCount: 1, reason: expect.stringContaining('AccessDenied') })
    expect(uploadBannerHeadline(b!)).toBe('1 recording file failed to upload.')
  })

  it('shows a reason without failed files (nothing attempted)', () => {
    const b = uploadBanner({ finishedAt: 'x', uploaded: 0, failed: [], reason: 'no-storage-target' })
    expect(b?.failedCount).toBe(0)
    expect(b?.reason).toMatch(/No storage target/)
    expect(uploadBannerHeadline(b!)).toBe('Recordings were not uploaded.')
  })

  it('uses the first file error when there is no reason', () => {
    const b = uploadBanner({ finishedAt: 'x', uploaded: 1, failed: [{ file: 'a', error: 'SlowDown' }, { file: 'b', error: 'x' }] })
    expect(b).toEqual({ failedCount: 2, reason: 'SlowDown' })
    expect(uploadBannerHeadline(b!)).toBe('2 recording files failed to upload.')
  })
})

describe('upload in progress', () => {
  it('is shown while a deactivate is in flight for the scope', () => {
    expect(isUploading({ 'prod-1': 'deactivate' }, 'prod-1')).toBe(true)
    expect(isUploading({ 'prod-1': 'activate' }, 'prod-1')).toBe(false)
    expect(isUploading({ 'prod-2': 'deactivate' }, 'prod-1')).toBe(false)
    expect(isUploading({ 'prod-2': 'deactivate' }, null)).toBe(true)
  })

  it('detects a finished deactivate so the list refreshes', () => {
    expect(finishedDeactivations({ 'prod-1': 'deactivate' }, {}, 'prod-1')).toEqual(['prod-1'])
    expect(finishedDeactivations({ 'prod-1': 'deactivate' }, { 'prod-1': 'deactivate' }, 'prod-1')).toEqual([])
    expect(finishedDeactivations({ 'prod-2': 'deactivate' }, {}, 'prod-1')).toEqual([])
    expect(finishedDeactivations({ 'prod-2': 'deactivate' }, {}, null)).toEqual(['prod-2'])
    expect(finishedDeactivations({ 'prod-1': 'activate' }, {}, null)).toEqual([])
  })
})

describe('player error states', () => {
  const signed = 'https://s3.example.com/a.mp4?X-Amz-Date=20261019T100000Z&X-Amz-Expires=60&X-Amz-Signature=abc'

  it('detects an expired presigned link', () => {
    const signedAt = Date.UTC(2026, 9, 19, 10, 0, 0)
    expect(isPresignExpired(signed, signedAt + 59_000)).toBe(false)
    expect(isPresignExpired(signed, signedAt + 61_000)).toBe(true)
    expect(isPresignExpired('https://s3.example.com/a.mp4', signedAt)).toBe(false)
    expect(isPresignExpired('not a url')).toBe(false)
  })

  it('detects mixed content', () => {
    expect(isMixedContent('http://minio:9000/a.mp4', 'https:')).toBe(true)
    expect(isMixedContent('https://s3/a.mp4', 'https:')).toBe(false)
    expect(isMixedContent('http://minio:9000/a.mp4', 'http:')).toBe(false)
  })

  it('classifies each failure', () => {
    const base = { expired: false, mixedContent: false }
    expect(classifyPlaybackError({ ...base, expired: true, probe: { kind: 'reachable' } })).toBe('expired-or-denied')
    expect(classifyPlaybackError({ ...base, probe: { kind: 'status', status: 403 } })).toBe('expired-or-denied')
    expect(classifyPlaybackError({ ...base, mixedContent: true, probe: { kind: 'reachable' } })).toBe('unreachable')
    expect(classifyPlaybackError({ ...base, probe: { kind: 'unreachable' } })).toBe('unreachable')
    expect(classifyPlaybackError({ ...base, probe: { kind: 'status', status: 206 } })).toBe('unsupported')
    expect(classifyPlaybackError({ ...base, probe: { kind: 'reachable' }, mediaErrorCode: 3 })).toBe('unsupported')
    expect(classifyPlaybackError({ ...base, probe: { kind: 'reachable' }, mediaErrorCode: 4 })).toBe('expired-or-denied')
  })

  it('has distinct text per state, and the unreachable text mentions https on an https page', () => {
    const kinds = ['expired-or-denied', 'unreachable', 'unsupported'] as const
    expect(new Set(kinds.map((k) => playbackErrorMessage(k, 'https:'))).size).toBe(3)
    expect(playbackErrorMessage('unreachable', 'https:')).toMatch(/reachable from the browser.*https/)
    expect(playbackErrorMessage('expired-or-denied', 'https:')).toMatch(/403/)
  })

  it('probe: an unreachable host rejects the no-cors request', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await probePlaybackUrl(signed, fetchImpl)).toEqual({ kind: 'unreachable' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('probe: reads the status when CORS allows it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ status: 0 })
      .mockResolvedValueOnce({ status: 403 })
    expect(await probePlaybackUrl(signed, fetchImpl)).toEqual({ kind: 'status', status: 403 })
  })

  it('probe: reachable but CORS-blocked is "reachable"', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ status: 0 })
      .mockRejectedValueOnce(new TypeError('CORS'))
    expect(await probePlaybackUrl(signed, fetchImpl)).toEqual({ kind: 'reachable' })
  })
})

describe('recordingsApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    upsertToastByTag.mockClear()
  })

  it('get fetches the single recording (the fresh link) by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(rec({ id: 'recording-a/b' })), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const got = await recordingsApi.get('recording-a/b')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://test/api/v1/recordings/recording-a%2Fb')
    expect(init.method ?? 'GET').toBe('GET')
    expect(got.id).toBe('recording-a/b')
  })

  it('lists all recordings, or one production\'s', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('[]', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    await recordingsApi.list()
    await recordingsApi.listForProduction('prod-1')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'http://test/api/v1/recordings',
      'http://test/api/v1/productions/prod-1/recordings',
    ])
  })

  it('a 503 throws the backend message with its status and raises no toast', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Database unavailable', statusCode: 503 }), { status: 503 }),
    ))
    const err = await recordingsApi.list().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(503)
    expect((err as ApiError).message).toBe('Database unavailable')
    expect(upsertToastByTag).not.toHaveBeenCalled()
  })

  it('delete sends DELETE for the encoded id and resolves on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(recordingsApi.delete('recording-a/b')).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://test/api/v1/recordings/recording-a%2Fb')
    expect(init.method).toBe('DELETE')
  })

  it('a failed delete carries the reason body and raises no toast', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Storage refused', reason: 'storage-denied', statusCode: 502 }), { status: 502 }),
    ))
    const err = await recordingsApi.delete('recording-1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(502)
    expect((err as ApiError).body).toMatchObject({ reason: 'storage-denied' })
    expect(upsertToastByTag).not.toHaveBeenCalled()
  })
})

describe('recordingDeleteErrorMessage', () => {
  it.each([
    ['connection-missing', 409, 'storage connection no longer exists'],
    ['connection-no-bucket', 409, 'storage connection has no bucket'],
    ['storage-not-configured', 409, 'default storage is not configured'],
    ['bucket-mismatch', 409, 'bucket other than the instance default'],
    ['storage-denied', 502, 'storage key is not allowed to delete this file'],
    ['storage-failed', 502, 'storage could not delete the file'],
  ])('maps reason %s (%i)', (reason, status, text) => {
    expect(recordingDeleteErrorMessage(new ApiError('x', status, { error: 'x', reason }))).toContain(text)
  })

  it('404 and 503 get a next step', () => {
    expect(recordingDeleteErrorMessage(new ApiError('Recording not found', 404))).toContain('Refresh the list')
    expect(recordingDeleteErrorMessage(new ApiError('Database unavailable', 503))).toContain('Try Delete again')
  })

  it('an unknown reason falls back to the backend message and names the reason', () => {
    expect(recordingDeleteErrorMessage(new ApiError('Odd failure', 409, { reason: 'new-reason' })))
      .toBe('Delete failed: Odd failure (new-reason)')
  })

  it('a network failure says open-live could not be reached', () => {
    expect(recordingDeleteErrorMessage(new TypeError('Failed to fetch'))).toBe('Could not reach open-live: Failed to fetch')
  })
})

describe('recordingsApi list filters (OL-32)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends kind / mixerInput / activationId / sourceId as query parameters', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('[]', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    await recordingsApi.list({ kind: 'input' })
    await recordingsApi.listForProduction('prod-1', { mixerInput: 'video_in_2', activationId: 'flow-1', sourceId: 'Whip' })
    await recordingsApi.listForProduction('prod-1', {})
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'http://test/api/v1/recordings?kind=input',
      'http://test/api/v1/productions/prod-1/recordings?activationId=flow-1&mixerInput=video_in_2&sourceId=Whip',
      'http://test/api/v1/productions/prod-1/recordings',
    ])
  })
})

describe('input recording labels (OL-32)', () => {
  it('reads an absent kind as program', () => {
    expect(recordingKind({})).toBe('program')
    expect(recordingKind({ kind: 'input' })).toBe('input')
    expect(recordingKind({ kind: 'future' })).toBe('future')
  })

  it('labels program, inputs by sourceName, and WHIP guests with their label', () => {
    expect(recordingSourceLabel({})).toBe('Program')
    expect(recordingSourceLabel({ kind: 'input', mixerInput: 'video_in_1', sourceName: 'Cam 2' })).toBe('Cam 2')
    expect(recordingSourceLabel({ kind: 'input', mixerInput: 'video_in_15', sourceName: 'Guest 1 · In 16', guestLabel: 'Anna' }))
      .toBe('Guest 1 · In 16 (Anna)')
    expect(recordingSourceLabel({ kind: 'input', mixerInput: 'video_in_2' })).toBe('Input 3')
  })

  it('detects input recordings in a list', () => {
    expect(hasInputRecordings([{}, { kind: 'program' }])).toBe(false)
    expect(hasInputRecordings([{}, { kind: 'input' }])).toBe(true)
  })

  it('offers each recorded input once, in pad order, with its latest label', () => {
    const opts = recordingInputOptions([
      rec({ kind: 'input', mixerInput: 'video_in_10', sourceName: 'Cam 11', startedAt: '2026-10-01T10:00:00Z' }),
      rec({ kind: 'input', mixerInput: 'video_in_2', sourceName: 'Old name', startedAt: '2026-10-01T10:00:00Z' }),
      rec({ kind: 'input', mixerInput: 'video_in_2', sourceName: 'Cam 3', startedAt: '2026-10-02T10:00:00Z' }),
      rec({}),
    ])
    expect(opts).toEqual([
      { mixerInput: 'video_in_2', label: 'Cam 3 · Input 3' },
      { mixerInput: 'video_in_10', label: 'Cam 11 · Input 11' },
    ])
  })
})

describe('groupRecordingRows (OL-32)', () => {
  const prods = [{ id: 'prod-1', name: 'Show' }]
  const at = (m: number) => `2026-10-25T18:${String(m).padStart(2, '0')}:00.000Z`

  it('groups by activation, newest first, program before inputs in pad order then part', () => {
    const list = [
      rec({ id: 'a-in2', key: 'k1', activationId: 'flow-a', kind: 'input', mixerInput: 'video_in_10', sourceName: 'Cam 11', startedAt: at(1), partIndex: 0 }),
      rec({ id: 'a-pgm1', key: 'k2', activationId: 'flow-a', kind: 'program', startedAt: at(6), partIndex: 1 }),
      rec({ id: 'a-pgm0', key: 'k3', activationId: 'flow-a', kind: 'program', startedAt: at(1), partIndex: 0 }),
      rec({ id: 'a-in0', key: 'k4', activationId: 'flow-a', kind: 'input', mixerInput: 'video_in_2', sourceName: 'Cam 3', startedAt: at(1), partIndex: 0 }),
      rec({ id: 'b-pgm', key: 'k5', activationId: 'flow-b', startedAt: at(30) }),
      rec({ id: 'old', key: 'k6', startedAt: at(59) }),
    ]
    const groups = groupRecordingRows(buildRecordingRows(list, prods, []))
    expect(groups.map((g) => g.activationId ?? null)).toEqual(['flow-b', 'flow-a', null])
    const a = groups[1]!
    expect(a.rows.map((r) => r.recording.id)).toEqual(['a-pgm0', 'a-pgm1', 'a-in0', 'a-in2'])
    expect(a.rows.map((r) => r.sourceLabel)).toEqual(['Program', 'Program', 'Cam 3', 'Cam 11'])
    expect(a.startedAt).toBe(at(1))
    expect(a.productionName).toBe('Show')
  })
})
