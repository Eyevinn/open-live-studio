import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiRecording } from '@/lib/api'

// Mock the API layer so the store under test never performs real network I/O.
// ApiError is re-implemented here so `instanceof` checks in helpers still work.
vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(message: string, public readonly status: number, public readonly body?: unknown) {
      super(message)
      this.name = 'ApiError'
    }
  }
  return {
    ApiError,
    DEFAULT_STORAGE_CONNECTION_ID: 'default',
    recordingsApi: {
      list: vi.fn(),
      listForProduction: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    },
  }
})

import { ApiError, recordingsApi } from '@/lib/api'
import { useRecordingsStore } from './recordings.store'

function makeRecording(overrides: Partial<ApiRecording> = {}): ApiRecording {
  return {
    id: 'recording-1',
    productionId: 'prod-1',
    bucket: 'recordings',
    key: 'prod-1/recording_2026-10-19T10-00-00.mp4',
    sizeBytes: 1024,
    durationMs: 60_000,
    startedAt: '2026-10-19T10:00:00.000Z',
    createdAt: '2026-10-19T10:05:00.000Z',
    updatedAt: '2026-10-19T10:05:00.000Z',
    playbackUrl: 'https://s3.example.com/recordings/a.mp4?X-Amz-Signature=old',
    downloadUrl: 'https://s3.example.com/recordings/a.mp4?X-Amz-Signature=old&response-content-disposition=attachment',
    ...overrides,
  }
}

const api = vi.mocked(recordingsApi)

beforeEach(() => {
  vi.clearAllMocks()
  useRecordingsStore.setState({ recordings: [], productionFilter: null, isLoading: false, loadError: null, loaded: false, kindFilter: null, inputFilter: null })
})

describe('useRecordingsStore.fetchList', () => {
  it('lists all recordings newest first by startedAt', async () => {
    api.list.mockResolvedValue([
      makeRecording({ id: 'old', startedAt: '2026-10-18T10:00:00.000Z' }),
      makeRecording({ id: 'new', startedAt: '2026-10-19T12:00:00.000Z' }),
      makeRecording({ id: 'mid', startedAt: '2026-10-19T08:00:00.000Z' }),
    ])

    await useRecordingsStore.getState().fetchList()

    expect(api.list).toHaveBeenCalledTimes(1)
    expect(api.listForProduction).not.toHaveBeenCalled()
    const s = useRecordingsStore.getState()
    expect(s.recordings.map((r) => r.id)).toEqual(['new', 'mid', 'old'])
    expect(s.loaded).toBe(true)
    expect(s.loadError).toBeNull()
  })

  it('an empty list is loaded with no error (the empty state, not an error)', async () => {
    api.list.mockResolvedValue([])
    await useRecordingsStore.getState().fetchList()
    const s = useRecordingsStore.getState()
    expect(s.recordings).toEqual([])
    expect(s.loaded).toBe(true)
    expect(s.loadError).toBeNull()
  })

  it('a backend 503 keeps the backend message and status and is not "loaded"', async () => {
    api.list.mockRejectedValue(new ApiError('Database unavailable', 503))
    await useRecordingsStore.getState().fetchList()
    const s = useRecordingsStore.getState()
    expect(s.loadError).toEqual({ message: 'Database unavailable', status: 503 })
    expect(s.loaded).toBe(false)
    expect(s.isLoading).toBe(false)
  })

  it('a network failure gives a readable message without a status', async () => {
    api.list.mockRejectedValue(new TypeError('Failed to fetch'))
    await useRecordingsStore.getState().fetchList()
    expect(useRecordingsStore.getState().loadError).toEqual({ message: 'Could not reach open-live: Failed to fetch' })
  })

  it('Retry after a failure clears the error', async () => {
    api.list.mockRejectedValueOnce(new ApiError('Database unavailable', 503))
    await useRecordingsStore.getState().fetchList()
    api.list.mockResolvedValueOnce([makeRecording()])
    await useRecordingsStore.getState().fetchList()
    const s = useRecordingsStore.getState()
    expect(s.loadError).toBeNull()
    expect(s.recordings).toHaveLength(1)
  })
})

describe('useRecordingsStore.setProductionFilter', () => {
  it('uses the per-production list when a filter is set', async () => {
    api.listForProduction.mockResolvedValue([makeRecording({ productionId: 'prod-2' })])

    await useRecordingsStore.getState().setProductionFilter('prod-2')

    expect(api.listForProduction).toHaveBeenCalledWith('prod-2')
    expect(api.list).not.toHaveBeenCalled()
    expect(useRecordingsStore.getState().productionFilter).toBe('prod-2')
    expect(useRecordingsStore.getState().recordings).toHaveLength(1)
  })

  it('clearing the filter goes back to the all-recordings list', async () => {
    useRecordingsStore.setState({ productionFilter: 'prod-2', recordings: [makeRecording()] })
    api.list.mockResolvedValue([])
    await useRecordingsStore.getState().setProductionFilter(null)
    expect(api.list).toHaveBeenCalledTimes(1)
    expect(useRecordingsStore.getState().productionFilter).toBeNull()
  })

  it('a production 404 is shown as an error for that filter', async () => {
    api.listForProduction.mockRejectedValue(new ApiError('Production not found', 404))
    await useRecordingsStore.getState().setProductionFilter('gone')
    expect(useRecordingsStore.getState().loadError).toEqual({ message: 'Production not found', status: 404 })
  })

  it('a slower response for a previous filter does not overwrite the current list', async () => {
    let resolveAll: (v: ApiRecording[]) => void = () => {}
    api.list.mockReturnValue(new Promise<ApiRecording[]>((r) => { resolveAll = r }))
    api.listForProduction.mockResolvedValue([makeRecording({ id: 'filtered', productionId: 'prod-2' })])

    const first = useRecordingsStore.getState().fetchList()
    await useRecordingsStore.getState().setProductionFilter('prod-2')
    resolveAll([makeRecording({ id: 'stale-all' })])
    await first

    expect(useRecordingsStore.getState().recordings.map((r) => r.id)).toEqual(['filtered'])
  })
})

describe('useRecordingsStore.fetchFresh', () => {
  it('re-reads the single recording for a fresh link and updates the list entry', async () => {
    useRecordingsStore.setState({ recordings: [makeRecording()] })
    const fresh = makeRecording({ playbackUrl: 'https://s3.example.com/recordings/a.mp4?X-Amz-Signature=new' })
    api.get.mockResolvedValue(fresh)

    const got = await useRecordingsStore.getState().fetchFresh('recording-1')

    expect(api.get).toHaveBeenCalledWith('recording-1')
    expect(got.playbackUrl).toContain('Signature=new')
    expect(useRecordingsStore.getState().recordings[0]?.playbackUrl).toContain('Signature=new')
  })

  it('fetches again on every call (never reuses a previous link)', async () => {
    api.get.mockResolvedValue(makeRecording())
    await useRecordingsStore.getState().fetchFresh('recording-1')
    await useRecordingsStore.getState().fetchFresh('recording-1')
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('rethrows the backend error (e.g. 404) for the player to show', async () => {
    api.get.mockRejectedValue(new ApiError('Recording not found', 404))
    await expect(useRecordingsStore.getState().fetchFresh('recording-x')).rejects.toThrow('Recording not found')
  })
})

describe('useRecordingsStore.deleteRecording', () => {
  it('deletes and removes only that recording from the list', async () => {
    useRecordingsStore.setState({ recordings: [makeRecording({ id: 'a' }), makeRecording({ id: 'b' })] })
    api.delete.mockResolvedValue(undefined)

    await useRecordingsStore.getState().deleteRecording('a')

    expect(api.delete).toHaveBeenCalledWith('a')
    expect(useRecordingsStore.getState().recordings.map((r) => r.id)).toEqual(['b'])
  })

  it('rethrows and keeps the list unchanged on failure', async () => {
    useRecordingsStore.setState({ recordings: [makeRecording({ id: 'a' })] })
    api.delete.mockRejectedValue(new ApiError('Storage refused', 502, { reason: 'storage-denied' }))

    await expect(useRecordingsStore.getState().deleteRecording('a')).rejects.toThrow('Storage refused')
    expect(useRecordingsStore.getState().recordings.map((r) => r.id)).toEqual(['a'])
  })
})

describe('kind and input filters (OL-32, studio#233)', () => {
  it('passes kind and mixerInput as query filters', async () => {
    api.list.mockResolvedValue([])
    api.listForProduction.mockResolvedValue([])
    await useRecordingsStore.getState().setKindFilter('input')
    expect(api.list).toHaveBeenLastCalledWith({ kind: 'input' })
    await useRecordingsStore.getState().setProductionFilter('prod-1')
    await useRecordingsStore.getState().setInputFilter('video_in_2')
    expect(api.listForProduction).toHaveBeenLastCalledWith('prod-1', { kind: 'input', mixerInput: 'video_in_2' })
  })

  it('calls the list without filters exactly as before when none are set', async () => {
    api.listForProduction.mockResolvedValue([])
    await useRecordingsStore.getState().setProductionFilter('prod-1')
    expect(api.listForProduction).toHaveBeenLastCalledWith('prod-1')
  })

  it('clears the input filter when the production changes, and on kind=program', async () => {
    api.list.mockResolvedValue([])
    api.listForProduction.mockResolvedValue([])
    await useRecordingsStore.getState().setProductionFilter('prod-1')
    await useRecordingsStore.getState().setInputFilter('video_in_2')
    await useRecordingsStore.getState().setProductionFilter('prod-2')
    expect(useRecordingsStore.getState().inputFilter).toBeNull()
    await useRecordingsStore.getState().setInputFilter('video_in_1')
    await useRecordingsStore.getState().setKindFilter('program')
    expect(useRecordingsStore.getState().inputFilter).toBeNull()
    expect(api.listForProduction).toHaveBeenLastCalledWith('prod-2', { kind: 'program' })
  })
})
