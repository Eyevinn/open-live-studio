import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiSource } from '@/lib/api'

// Mock the API layer so the store under test never performs real network I/O.
vi.mock('@/lib/api', () => ({
  sourcesApi: {
    list: vi.fn(),
    audioStreams: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    updateAuth: vi.fn(),
    rotateAuth: vi.fn(),
  },
}))

// Imported after the mock is registered.
import { sourcesApi } from '@/lib/api'
import { useSourcesStore, type Source } from './sources.store'

function makeApiSource(overrides: Partial<ApiSource> = {}): ApiSource {
  return {
    id: 's1',
    name: 'Cam A',
    address: 'srt://host:1234',
    streamType: 'srt',
    status: 'inactive',
    ...overrides,
  }
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 's1',
    name: 'Cam A',
    address: 'srt://host:1234',
    streamType: 'srt',
    status: 'inactive',
    color: '#27272a',
    audioStreamIndex: 0,
    ...overrides,
  }
}

const update = vi.mocked(sourcesApi.update)

beforeEach(() => {
  vi.clearAllMocks()
  useSourcesStore.setState({ sources: [makeSource()], lastFetchedAt: Date.now(), isLoading: false })
})

describe('useSourcesStore.updateSource', () => {
  it('forwards audioStreamIndex to the API and mirrors the echoed value', async () => {
    update.mockResolvedValue(makeApiSource({ audioStreamIndex: 2 }))

    await useSourcesStore.getState().updateSource('s1', { audioStreamIndex: 2 })

    expect(update).toHaveBeenCalledWith('s1', { audioStreamIndex: 2 })
    expect(useSourcesStore.getState().sources[0]?.audioStreamIndex).toBe(2)
  })

  it('mirrors an echoed audioStreamIndex of 0', async () => {
    useSourcesStore.setState({ sources: [makeSource({ audioStreamIndex: 3 })] })
    update.mockResolvedValue(makeApiSource({ audioStreamIndex: 0 }))

    await useSourcesStore.getState().updateSource('s1', { audioStreamIndex: 0 })

    expect(useSourcesStore.getState().sources[0]?.audioStreamIndex).toBe(0)
  })
})
