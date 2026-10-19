import { afterEach, describe, expect, it, vi } from 'vitest'

// api.ts reads `window._env_` and the SAT auth on import; stub both so the real
// ApiError class and outputsApi can be loaded in the node test environment.
vi.mock('./base.js', () => ({ BASE: 'http://test' }))
vi.mock('./sat.js', () => ({ authenticateWithOpenLive: vi.fn(), getApiToken: vi.fn().mockResolvedValue(null) }))
const upsertToastByTag = vi.fn()
vi.mock('../store/toast.store', () => ({ useToastStore: { getState: () => ({ upsertToastByTag }) } }))
vi.mock('../hooks/useConnectionCheck', () => ({ isInitialCheckDone: () => true }))

import { ApiError, outputsApi, type ApiOutput, type ApiStorageConnection } from './api'
import {
  ONE_RECORDING_PER_PRODUCTION,
  outputSaveErrorMessage,
  recordingCreateInput,
  recordingPatchInput,
  recordingPickerConnections,
  recordingSlotConflict,
  recordingStorageLabel,
  recordingStorageOptions,
  storageSelection,
} from './recordingOutput'

function conn(overrides: Partial<ApiStorageConnection> = {}): ApiStorageConnection {
  return {
    id: 'stconn-1', name: 'Archive', endpoint: 's3.example.com', region: 'us-east-1', useSsl: true,
    defaultBucket: 'recordings', role: 'recording', accessKey: 'AK', secretKeySet: true,
    createdAt: null, updatedAt: null, ...overrides,
  }
}

const DEFAULT = conn({ id: 'default', name: 'Default (instance storage)', role: 'both', isDefault: true })

function output(overrides: Partial<ApiOutput> = {}): ApiOutput {
  return {
    id: 'output-1', name: 'Program SRT', outputType: 'mpegtssrt',
    createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', ...overrides,
  }
}

describe('recordingPickerConnections', () => {
  it('offers role recording and both, never clip or the synthetic default', () => {
    const all = [DEFAULT, conn({ id: 'a', role: 'recording' }), conn({ id: 'b', role: 'both' }), conn({ id: 'c', role: 'clip' })]
    expect(recordingPickerConnections(all).map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('recordingStorageOptions', () => {
  it('lists the default first, then matching connections', () => {
    const { options, available } = recordingStorageOptions([DEFAULT, conn(), conn({ id: 'clip', role: 'clip' })])
    expect(options.map((o) => o.value)).toEqual(['', 'stconn-1'])
    expect(options[0]?.label).toBe('Default (instance storage) (default)')
    expect(options[1]?.label).toBe('Archive · recordings')
    expect(available).toBe(true)
  })

  it('reports no storage available without a default and without a recording connection', () => {
    expect(recordingStorageOptions([])).toEqual({ options: [], available: false })
    expect(recordingStorageOptions([conn({ role: 'clip' })]).available).toBe(false)
  })

  it('lists a connection without a default bucket as disabled, and it does not count as available', () => {
    const { options, available } = recordingStorageOptions([conn({ defaultBucket: undefined })])
    expect(options).toEqual([{ value: 'stconn-1', label: 'Archive (no default bucket)', disabled: true }])
    expect(available).toBe(false)
  })

  it('keeps the edited output\'s current storage when it is no longer offered', () => {
    const gone = recordingStorageOptions([DEFAULT], 'stconn-gone').options
    expect(gone.map((o) => o.value)).toEqual(['', 'stconn-gone'])
    expect(gone[1]?.label).toBe('Unknown connection (stconn-gone)')

    const clipRole = recordingStorageOptions([conn({ id: 'c', name: 'Clips', role: 'clip' })], 'c').options
    expect(clipRole).toEqual([{ value: 'c', label: 'Clips' }])

    const noDefault = recordingStorageOptions([conn()], '').options
    expect(noDefault[0]).toEqual({ value: '', label: 'Default (not configured on this server)' })
  })
})

describe('storage selection and labels', () => {
  it('treats absent and "default" connectionId as the default', () => {
    expect(storageSelection(undefined)).toBe('')
    expect(storageSelection('default')).toBe('')
    expect(storageSelection('stconn-1')).toBe('stconn-1')
  })

  it('labels the row with the connection name, Default, or the dangling id', () => {
    expect(recordingStorageLabel(undefined, [conn()])).toBe('Default')
    expect(recordingStorageLabel('default', [conn()])).toBe('Default')
    expect(recordingStorageLabel('stconn-1', [conn()])).toBe('Archive')
    expect(recordingStorageLabel('x', [conn()])).toBe('Unknown connection (x)')
  })
})

describe('recordingCreateInput', () => {
  it('sends connectionId for a stored connection', () => {
    expect(recordingCreateInput(' Program rec ', 'stconn-1')).toEqual({ name: 'Program rec', outputType: 'recording', connectionId: 'stconn-1' })
  })

  it('sends no connectionId when left on the default', () => {
    const body = recordingCreateInput('Program rec', '')
    expect(body).toEqual({ name: 'Program rec', outputType: 'recording' })
    expect(body).not.toHaveProperty('connectionId')
  })
})

describe('recordingPatchInput', () => {
  it('re-points to another connection', () => {
    expect(recordingPatchInput('Rec', { name: 'Rec', connectionId: 'stconn-1' }, 'stconn-2')).toEqual({ connectionId: 'stconn-2' })
  })

  it('re-points to the default with the reserved id, since PATCH cannot remove a field', () => {
    expect(recordingPatchInput('Rec', { name: 'Rec', connectionId: 'stconn-1' }, '')).toEqual({ connectionId: 'default' })
  })

  it('sends only the name on a rename, and nothing when unchanged', () => {
    expect(recordingPatchInput('New', { name: 'Rec' }, '')).toEqual({ name: 'New' })
    expect(recordingPatchInput('Rec', { name: 'Rec', connectionId: 'default' }, '')).toEqual({})
  })
})

describe('recordingSlotConflict', () => {
  const outputs = [
    output({ id: 'srt' }),
    output({ id: 'rec-a', name: 'Main recording', outputType: 'recording' }),
    output({ id: 'rec-b', name: 'Backup recording', outputType: 'recording' }),
  ]

  it('refuses a second Recording output and names the assigned one', () => {
    const reason = recordingSlotConflict(['rec-a', ''], 1, 'rec-b', outputs)
    expect(reason).toBe(`${ONE_RECORDING_PER_PRODUCTION} "Main recording" is already assigned.`)
  })

  it('allows the first Recording output, replacing it in its own slot, and non-recording outputs', () => {
    expect(recordingSlotConflict(['srt', ''], 1, 'rec-a', outputs)).toBeNull()
    expect(recordingSlotConflict(['rec-a', 'srt'], 0, 'rec-b', outputs)).toBeNull()
    expect(recordingSlotConflict(['rec-a', ''], 1, 'srt', outputs)).toBeNull()
    expect(recordingSlotConflict(['rec-a', ''], 1, '', outputs)).toBeNull()
  })
})

describe('outputSaveErrorMessage', () => {
  it('returns the backend message', () => {
    const msg = 'Recording needs object storage: set the MINIO_* environment variables or choose a storage connection (connectionId)'
    expect(outputSaveErrorMessage(new ApiError(msg, 400))).toBe(msg)
  })

  it('appends zod issues of a validation 400', () => {
    const err = new ApiError('Validation error', 400, { error: 'Validation error', issues: [{ path: ['connectionId'], message: 'connectionId is only valid on a recording output' }] })
    expect(outputSaveErrorMessage(err)).toBe('Validation error: connectionId: connectionId is only valid on a recording output')
  })
})

describe('outputsApi create/update (single display of the backend 400)', () => {
  afterEach(() => { vi.unstubAllGlobals(); upsertToastByTag.mockClear() })

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('throws the backend message on create without raising a toast', async () => {
    const fetchMock = stubFetch(400, { error: 'Storage connection has no default bucket', statusCode: 400 })
    const err: unknown = await outputsApi.create({ name: 'Rec', outputType: 'recording', connectionId: 'stconn-1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe('Storage connection has no default bucket')
    expect(upsertToastByTag).not.toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://test/api/v1/outputs')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Rec', outputType: 'recording', connectionId: 'stconn-1' })
  })

  it('PATCHes connectionId and throws without a toast on 400', async () => {
    const fetchMock = stubFetch(400, { error: 'Storage connection not found', statusCode: 400 })
    await expect(outputsApi.update('output-1', { connectionId: 'gone' })).rejects.toThrow('Storage connection not found')
    expect(upsertToastByTag).not.toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://test/api/v1/outputs/output-1')
    expect(init.method).toBe('PATCH')
  })
})
