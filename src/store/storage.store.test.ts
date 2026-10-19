import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiStorageConnection } from '@/lib/api'

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
    storageConnectionsApi: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      test: vi.fn(),
    },
  }
})

import { ApiError, storageConnectionsApi } from '@/lib/api'
import { buildPatchInput, formFromConnection } from '@/lib/storageConnection'
import { useStorageStore } from './storage.store'

function makeConnection(overrides: Partial<ApiStorageConnection> = {}): ApiStorageConnection {
  return {
    id: 'stconn-1',
    name: 'Customer clips',
    endpoint: 's3.example.com',
    region: 'us-east-1',
    useSsl: true,
    defaultBucket: 'clips',
    role: 'clip',
    accessKey: 'AKIAEXAMPLE',
    secretKeySet: true,
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    ...overrides,
  }
}

const api = vi.mocked(storageConnectionsApi)

beforeEach(() => {
  vi.clearAllMocks()
  useStorageStore.setState({ connections: [makeConnection()], lastFetchedAt: Date.now(), isLoading: false, loadError: null, loaded: false })
})

describe('useStorageStore.addConnection', () => {
  it('creates the connection and appends the returned view (which has no secret)', async () => {
    const created = makeConnection({ id: 'stconn-2', name: 'Recordings' })
    api.create.mockResolvedValue(created)

    const body = { name: 'Recordings', endpoint: 's3.example.com', accessKey: 'AK', secretKey: 'shh' }
    await useStorageStore.getState().addConnection(body)

    expect(api.create).toHaveBeenCalledWith(body)
    const ids = useStorageStore.getState().connections.map((c) => c.id)
    expect(ids).toEqual(['stconn-1', 'stconn-2'])
    expect(JSON.stringify(useStorageStore.getState().connections)).not.toContain('shh')
  })

  it('rethrows the backend error and adds nothing', async () => {
    api.create.mockRejectedValue(new ApiError('endpoint resolves to a private/loopback/link-local address; add its host or CIDR to TRUSTED_STORAGE_HOSTS to allow it', 400))

    await expect(
      useStorageStore.getState().addConnection({ name: 'x', endpoint: '10.0.0.1', accessKey: 'a', secretKey: 'b' }),
    ).rejects.toThrow(/TRUSTED_STORAGE_HOSTS/)
    expect(useStorageStore.getState().connections).toHaveLength(1)
  })
})

describe('useStorageStore.updateConnection', () => {
  it('patches without secretKey when no new secret was typed', async () => {
    const original = makeConnection()
    const form = { ...formFromConnection(original), name: 'Renamed', defaultBucket: 'other-bucket' }
    const patch = buildPatchInput(form, original)
    api.update.mockResolvedValue(makeConnection({ name: 'Renamed', defaultBucket: 'other-bucket' }))

    await useStorageStore.getState().updateConnection(original.id, patch)

    expect(api.update).toHaveBeenCalledWith('stconn-1', { name: 'Renamed', defaultBucket: 'other-bucket' })
    const sent = api.update.mock.calls[0]?.[1]
    expect(sent).not.toHaveProperty('secretKey')
    expect(useStorageStore.getState().connections[0]?.name).toBe('Renamed')
    expect(useStorageStore.getState().connections[0]?.secretKeySet).toBe(true)
  })

  it('sends secretKey only when a new one was typed', async () => {
    const original = makeConnection()
    const patch = buildPatchInput({ ...formFromConnection(original), secretKey: 'new-secret' }, original)
    api.update.mockResolvedValue(original)

    await useStorageStore.getState().updateConnection(original.id, patch)

    expect(api.update).toHaveBeenCalledWith('stconn-1', { secretKey: 'new-secret' })
  })
})

describe('useStorageStore.removeConnection', () => {
  it('removes the connection on success', async () => {
    api.remove.mockResolvedValue(undefined)
    await useStorageStore.getState().removeConnection('stconn-1')
    expect(useStorageStore.getState().connections).toEqual([])
  })

  it('keeps the connection and rethrows the 409 with the backend message', async () => {
    const message = 'Storage connection is referenced by 2 source(s), 0 output(s), 1 recording(s) and cannot be deleted'
    api.remove.mockRejectedValue(new ApiError(message, 409, { error: message, references: { sources: 2, outputs: 0, recordings: 1 } }))

    const err: unknown = await useStorageStore.getState().removeConnection('stconn-1').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).message).toBe(message)
    expect(useStorageStore.getState().connections.map((c) => c.id)).toEqual(['stconn-1'])
  })
})

describe('useStorageStore.fetchAll', () => {
  it('stores the list with the default entry first', async () => {
    const def = makeConnection({ id: 'default', name: 'Default (instance storage)', isDefault: true, role: 'both', createdAt: null, updatedAt: null })
    api.list.mockResolvedValue([def, makeConnection()])
    await useStorageStore.getState().fetchAll()
    expect(useStorageStore.getState().connections.map((c) => c.id)).toEqual(['default', 'stconn-1'])
    expect(useStorageStore.getState().loadError).toBeNull()
    expect(useStorageStore.getState().loaded).toBe(true)
  })

  it('records the load error message', async () => {
    api.list.mockRejectedValue(new ApiError('Database unavailable', 503))
    await useStorageStore.getState().fetchAll()
    expect(useStorageStore.getState().loadError).toBe('Database unavailable')
    expect(useStorageStore.getState().loaded).toBe(false)
  })
})
