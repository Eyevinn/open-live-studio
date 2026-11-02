// @vitest-environment jsdom
/**
 * Component tests for the Storage tab free-space line (studio#245).
 *
 * `fetch` is stubbed with a small router that mimics open-live: the SAT
 * exchange answers 503 (no token, as in local dev), storage connections are
 * listed, and `GET /api/v1/storage-connections/:id/capacity` answers with
 * whatever the test configures per connection (contract from open-live #613 /
 * PR #615, spec §2.8a). The real API client, store and panel run unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ApiStorageCapacity, ApiStorageConnection } from '@/lib/api'
import {
  CAPACITY_FORBIDDEN_TEXT,
  CAPACITY_LOADING_TEXT,
  CAPACITY_NOT_SUPPORTED_TEXT,
  CAPACITY_UNREACHABLE_TEXT,
} from '@/lib/storageCapacity'
import { useStorageStore } from '@/store/storage.store'
import { StoragePanel } from './StoragePanel'

const CHECKED_AT = '2026-11-02T10:00:00.000Z'

function makeConnection(overrides: Partial<ApiStorageConnection> = {}): ApiStorageConnection {
  return {
    id: 'stconn-1',
    name: 'Venue MinIO',
    endpoint: 'minio.example.com',
    region: 'us-east-1',
    useSsl: true,
    defaultBucket: 'recordings',
    role: 'both',
    accessKey: 'AK',
    secretKeySet: true,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function available(overrides: Partial<Extract<ApiStorageCapacity, { status: 'available' }>> = {}): ApiStorageCapacity {
  return {
    status: 'available',
    totalBytes: 1e12,
    freeBytes: 678e9,
    scope: 'server',
    referenceBitrateKbps: 10000,
    estimatedMinutes: 9040,
    checkedAt: CHECKED_AT,
    ...overrides,
  }
}

function unavailable(reason: 'forbidden' | 'not-supported' | 'unreachable'): ApiStorageCapacity {
  return { status: 'unavailable', reason, checkedAt: CHECKED_AT }
}

interface Reply {
  status: number
  body?: unknown
}

let listed: ApiStorageConnection[] = []
let listReplies: Reply[] = []
/** Capacity reply per connection id; a function is called per request. */
let capacityReplies: Record<string, Reply | (() => Reply | Promise<Reply>)> = {}
const capacityCalls: string[] = []

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input))
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname
  if (path === '/api/v1/auth/token') return json(503, { error: 'No PAT configured' })
  if (path === '/api/v1/storage-connections' && method === 'GET') {
    const reply = listReplies.shift()
    if (reply) return json(reply.status, reply.body ?? {})
    return json(200, listed)
  }
  const cap = path.match(/^\/api\/v1\/storage-connections\/([^/]+)\/capacity$/)
  if (cap && method === 'GET') {
    const id = decodeURIComponent(cap[1]!)
    capacityCalls.push(id)
    const configured = capacityReplies[id]
    const reply = typeof configured === 'function' ? await configured() : configured
    if (!reply) return json(404, { error: 'Storage connection not found', statusCode: 404 })
    return json(reply.status, reply.body ?? {})
  }
  const one = path.match(/^\/api\/v1\/storage-connections\/([^/]+)$/)
  if (one && method === 'PATCH') {
    const id = decodeURIComponent(one[1]!)
    const patch = JSON.parse(String(init?.body ?? '{}')) as Partial<ApiStorageConnection>
    listed = listed.map((c) => (c.id === id ? { ...c, ...patch } : c))
    return json(200, listed.find((c) => c.id === id))
  }
  return json(404, { error: `Unhandled ${method} ${path}` })
})

beforeEach(() => {
  listed = [makeConnection()]
  listReplies = []
  capacityReplies = {}
  capacityCalls.length = 0
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  useStorageStore.setState({ connections: [], isLoading: false, loadError: null, loaded: false })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('.rounded')
  if (!row) throw new Error(`no row for ${name}`)
  return row as HTMLElement
}

async function capacityLineOf(name: string, text: string): Promise<HTMLElement> {
  await screen.findByText(name)
  return waitFor(() => {
    const line = within(rowOf(name)).getByTestId('storage-capacity')
    expect(line.textContent).toBe(text)
    return line
  })
}

describe('StoragePanel capacity line (studio#245)', () => {
  it('shows free space, total and the minutes estimate when available', async () => {
    capacityReplies['stconn-1'] = { status: 200, body: available() }
    render(<StoragePanel />)
    await capacityLineOf('Venue MinIO', 'Free: 678 GB of 1 TB (~9,040 min at 10 Mbit/s)')
  })

  it('marks a bucket-quota scope', async () => {
    capacityReplies['stconn-1'] = {
      status: 200,
      body: available({ scope: 'bucket-quota', totalBytes: 100e9, freeBytes: 60e9, estimatedMinutes: 800 }),
    }
    render(<StoragePanel />)
    await capacityLineOf('Venue MinIO', 'Free: 60 GB of 100 GB (~800 min at 10 Mbit/s) · bucket quota')
  })

  it('explains a forbidden key', async () => {
    capacityReplies['stconn-1'] = { status: 200, body: unavailable('forbidden') }
    render(<StoragePanel />)
    await capacityLineOf('Venue MinIO', CAPACITY_FORBIDDEN_TEXT)
  })

  it('reports storage that does not expose free space', async () => {
    capacityReplies['stconn-1'] = { status: 200, body: unavailable('not-supported') }
    render(<StoragePanel />)
    await capacityLineOf('Venue MinIO', CAPACITY_NOT_SUPPORTED_TEXT)
  })

  it('reports unreachable storage, and treats a failed request the same way', async () => {
    listed = [makeConnection(), makeConnection({ id: 'stconn-2', name: 'Second store' })]
    capacityReplies['stconn-1'] = { status: 200, body: unavailable('unreachable') }
    capacityReplies['stconn-2'] = { status: 500, body: { error: 'boom' } }
    render(<StoragePanel />)
    await capacityLineOf('Venue MinIO', CAPACITY_UNREACHABLE_TEXT)
    await capacityLineOf('Second store', CAPACITY_UNREACHABLE_TEXT)
  })

  it('shows a loading line while the capacity request is pending, per row', async () => {
    listed = [makeConnection(), makeConnection({ id: 'stconn-2', name: 'Second store' })]
    let release: (r: Reply) => void = () => {}
    capacityReplies['stconn-1'] = () => new Promise<Reply>((resolve) => { release = resolve })
    capacityReplies['stconn-2'] = { status: 200, body: unavailable('forbidden') }
    render(<StoragePanel />)
    await capacityLineOf('Venue MinIO', CAPACITY_LOADING_TEXT)
    // The other row is not held back by the pending one.
    await capacityLineOf('Second store', CAPACITY_FORBIDDEN_TEXT)
    release({ status: 200, body: available() })
    await capacityLineOf('Venue MinIO', 'Free: 678 GB of 1 TB (~9,040 min at 10 Mbit/s)')
  })

  it('re-fetches a row after that connection is edited', async () => {
    listed = [makeConnection(), makeConnection({ id: 'stconn-2', name: 'Second store' })]
    capacityReplies['stconn-1'] = { status: 200, body: unavailable('forbidden') }
    capacityReplies['stconn-2'] = { status: 200, body: unavailable('not-supported') }
    render(<StoragePanel />)
    await capacityLineOf('Venue MinIO', CAPACITY_FORBIDDEN_TEXT)
    await capacityLineOf('Second store', CAPACITY_NOT_SUPPORTED_TEXT)
    expect(capacityCalls.sort()).toEqual(['stconn-1', 'stconn-2'])

    capacityReplies['stconn-1'] = { status: 200, body: available() }
    fireEvent.click(within(rowOf('Venue MinIO')).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByPlaceholderText('my-clips'), { target: { value: 'other-bucket' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await capacityLineOf('Venue MinIO', 'Free: 678 GB of 1 TB (~9,040 min at 10 Mbit/s)')
    expect(capacityCalls.filter((id) => id === 'stconn-1')).toHaveLength(2)
    // Only the edited row is re-fetched.
    expect(capacityCalls.filter((id) => id === 'stconn-2')).toHaveLength(1)
  })

  it('fetches capacity on the panel refresh (Retry after a failed list)', async () => {
    listReplies = [{ status: 503, body: { error: 'Database unavailable' } }]
    capacityReplies['stconn-1'] = { status: 200, body: available() }
    render(<StoragePanel />)
    await screen.findByText(/Could not load storage connections/)
    expect(capacityCalls).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await capacityLineOf('Venue MinIO', 'Free: 678 GB of 1 TB (~9,040 min at 10 Mbit/s)')
    expect(capacityCalls).toEqual(['stconn-1'])
  })
})
