import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiOutput } from '@/lib/api'

// Mock the API layer so the store under test never performs real network I/O.
vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(message: string, public readonly status: number, public readonly body?: unknown) {
      super(message)
      this.name = 'ApiError'
    }
  }
  return {
    ApiError,
    outputsApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  }
})

import { ApiError, outputsApi } from '@/lib/api'
import { useOutputsStore } from './outputs.store'

function recording(overrides: Partial<ApiOutput> = {}): ApiOutput {
  return {
    id: 'output-rec', name: 'Program recording', outputType: 'recording', connectionId: 'stconn-1',
    createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', ...overrides,
  }
}

const api = vi.mocked(outputsApi)

beforeEach(() => {
  vi.clearAllMocks()
  useOutputsStore.setState({ outputs: [], lastFetchedAt: Date.now(), isLoading: false })
})

describe('useOutputsStore recording outputs', () => {
  it('creates a recording output with its connectionId and keeps it in the list', async () => {
    api.create.mockResolvedValue(recording())
    await useOutputsStore.getState().addOutput({ name: 'Program recording', outputType: 'recording', connectionId: 'stconn-1' })
    expect(api.create).toHaveBeenCalledWith({ name: 'Program recording', outputType: 'recording', connectionId: 'stconn-1' })
    expect(useOutputsStore.getState().outputs[0]?.connectionId).toBe('stconn-1')
  })

  it('rethrows a rejected create (backend 400) and adds nothing', async () => {
    api.create.mockRejectedValue(new ApiError('Recording needs object storage: set the MINIO_* environment variables or choose a storage connection (connectionId)', 400))
    await expect(
      useOutputsStore.getState().addOutput({ name: 'Program recording', outputType: 'recording' }),
    ).rejects.toThrow(/Recording needs object storage/)
    expect(useOutputsStore.getState().outputs).toEqual([])
  })

  it('re-points an output through PATCH and stores the returned view', async () => {
    useOutputsStore.setState({ outputs: [recording()] })
    api.update.mockResolvedValue(recording({ connectionId: 'stconn-2' }))
    await useOutputsStore.getState().updateOutput('output-rec', { connectionId: 'stconn-2' })
    expect(api.update).toHaveBeenCalledWith('output-rec', { connectionId: 'stconn-2' })
    expect(useOutputsStore.getState().outputs[0]?.connectionId).toBe('stconn-2')
  })

  it('keeps the stored output when re-pointing is rejected', async () => {
    useOutputsStore.setState({ outputs: [recording()] })
    api.update.mockRejectedValue(new ApiError('Storage connection not found', 400))
    await expect(useOutputsStore.getState().updateOutput('output-rec', { connectionId: 'gone' })).rejects.toThrow('Storage connection not found')
    expect(useOutputsStore.getState().outputs[0]?.connectionId).toBe('stconn-1')
  })
})
