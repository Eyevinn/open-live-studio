import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProduction } from '@/lib/api'

// Mock the API layer so the store under test never performs real network I/O.
// Each method is a vi.fn() whose behaviour is configured per test.
vi.mock('@/lib/api', () => ({
  productionsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    assignSource: vi.fn(),
    unassignSource: vi.fn(),
    assignGraphic: vi.fn(),
    unassignGraphic: vi.fn(),
    assignOutput: vi.fn(),
    unassignOutput: vi.fn(),
  },
}))

// Imported after the mock is registered.
import { productionsApi } from '@/lib/api'
import { useProductionsStore, type Production } from './productions.store'

function makeProduction(overrides: Partial<Production> = {}): Production {
  return {
    id: 'p1',
    name: 'Show',
    status: 'inactive',
    sources: [],
    graphicAssignments: [],
    outputAssignments: [],
    ...overrides,
  }
}

function makeApiProduction(overrides: Partial<ApiProduction> = {}): ApiProduction {
  return {
    id: 'p1',
    name: 'Show',
    status: 'active',
    sources: [],
    graphicAssignments: [],
    outputAssignments: [],
    ...overrides,
  }
}

/** A promise plus its resolver, to hold an API call "in flight" for assertions. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const initialState = useProductionsStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  // Reset to a known store state with one inactive production.
  useProductionsStore.setState({
    productions: [makeProduction()],
    isLoading: false,
    pendingStatus: {},
    lastFetchedAt: 0,
  })
})

afterEach(() => {
  useProductionsStore.setState(initialState, true)
})

describe('useProductionsStore.updateStatus', () => {
  it('marks the production pending while an activate request is in flight', () => {
    const d = deferred<ApiProduction>()
    vi.mocked(productionsApi.activate).mockReturnValue(d.promise)

    void useProductionsStore.getState().updateStatus('p1', 'active')

    expect(useProductionsStore.getState().pendingStatus['p1']).toBe('activate')
    expect(productionsApi.activate).toHaveBeenCalledTimes(1)

    // Clean up the dangling promise so it does not leak into later tests.
    d.resolve(makeApiProduction({ status: 'active' }))
  })

  it('ignores a second request for the same production while one is in flight', async () => {
    const d = deferred<ApiProduction>()
    vi.mocked(productionsApi.activate).mockReturnValue(d.promise)

    const first = useProductionsStore.getState().updateStatus('p1', 'active')
    // Second call should short-circuit and not invoke the API again.
    await useProductionsStore.getState().updateStatus('p1', 'active')

    expect(productionsApi.activate).toHaveBeenCalledTimes(1)
    expect(useProductionsStore.getState().pendingStatus['p1']).toBe('activate')

    d.resolve(makeApiProduction({ status: 'active' }))
    await first
  })

  it('clears the pending flag and applies the new status on success', async () => {
    vi.mocked(productionsApi.activate).mockResolvedValue(
      makeApiProduction({ status: 'active', stromFlowId: 'flow-1' }),
    )

    await useProductionsStore.getState().updateStatus('p1', 'active')

    const state = useProductionsStore.getState()
    expect(state.pendingStatus['p1']).toBeUndefined()
    const prod = state.productions.find((p) => p.id === 'p1')
    expect(prod?.status).toBe('active')
    expect(prod?.stromFlowId).toBe('flow-1')
  })

  it('clears the pending flag when the request FAILS (not only on success)', async () => {
    vi.mocked(productionsApi.deactivate).mockRejectedValue(new Error('boom'))

    await expect(
      useProductionsStore.getState().updateStatus('p1', 'inactive'),
    ).rejects.toThrow('boom')

    expect(useProductionsStore.getState().pendingStatus['p1']).toBeUndefined()
  })

  it('allows a new request after a failed one has cleared the pending flag', async () => {
    vi.mocked(productionsApi.deactivate)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(makeApiProduction({ status: 'inactive' }))

    await expect(
      useProductionsStore.getState().updateStatus('p1', 'inactive'),
    ).rejects.toThrow('boom')

    await useProductionsStore.getState().updateStatus('p1', 'inactive')

    expect(productionsApi.deactivate).toHaveBeenCalledTimes(2)
    expect(useProductionsStore.getState().productions.find((p) => p.id === 'p1')?.status).toBe(
      'inactive',
    )
  })

  it('tracks pending state per production, so a second production is not blocked', () => {
    useProductionsStore.setState({
      productions: [makeProduction({ id: 'p1' }), makeProduction({ id: 'p2' })],
      pendingStatus: {},
    })
    vi.mocked(productionsApi.activate).mockReturnValue(deferred<ApiProduction>().promise)

    void useProductionsStore.getState().updateStatus('p1', 'active')
    void useProductionsStore.getState().updateStatus('p2', 'active')

    expect(productionsApi.activate).toHaveBeenCalledTimes(2)
    expect(useProductionsStore.getState().pendingStatus).toEqual({
      p1: 'activate',
      p2: 'activate',
    })
  })
})

describe('useProductionsStore.markInactive', () => {
  it('resets status and clears endpoint fields synchronously', () => {
    useProductionsStore.setState({
      productions: [
        makeProduction({
          status: 'active',
          stromFlowId: 'flow-1',
          whepEndpoint: 'whep://x',
          srtOutputUri: 'srt://y',
        }),
      ],
    })

    useProductionsStore.getState().markInactive('p1')

    const prod = useProductionsStore.getState().productions.find((p) => p.id === 'p1')
    expect(prod?.status).toBe('inactive')
    expect(prod?.stromFlowId).toBeUndefined()
    expect(prod?.whepEndpoint).toBeUndefined()
    expect(prod?.srtOutputUri).toBeUndefined()
  })
})

describe('useProductionsStore.fetchAll', () => {
  it('populates productions from the API and toggles isLoading', async () => {
    vi.mocked(productionsApi.list).mockResolvedValue([
      makeApiProduction({ id: 'a', name: 'A', status: 'inactive' }),
      makeApiProduction({ id: 'b', name: 'B', status: 'active' }),
    ])

    await useProductionsStore.getState().fetchAll()

    const state = useProductionsStore.getState()
    expect(state.isLoading).toBe(false)
    expect(state.productions.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('clears isLoading even when the list request throws', async () => {
    vi.mocked(productionsApi.list).mockRejectedValue(new Error('offline'))

    await useProductionsStore.getState().fetchAll()

    expect(useProductionsStore.getState().isLoading).toBe(false)
  })
})
