import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// sat.ts imports `./base.js`, which reads `window` at module load. These tests
// run in the `node` environment and only exercise `getApiToken()` (which never
// touches the DOM), so stub BASE to keep the module importable without a DOM.
vi.mock('./base.js', () => ({ BASE: 'http://test' }))

type MockResponseInit = {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

function mockResponse({ status, body, headers }: MockResponseInit) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body ?? '')),
    headers: { get: (name: string) => headers?.[name.toLowerCase()] ?? null },
  }
}

const NO_PAT_CACHE_MS = 10 * 60 * 1000
const RATE_LIMIT_BACKOFF_MS = 60 * 1000

describe('getApiToken SAT caching (studio#182)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules() // fresh module-level cache/backoff state per test
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function loadSat() {
    return import('./sat')
  }

  it('caches a 503 (no PAT) so repeated calls do not re-ask within the window', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 503 }))
    const { getApiToken } = await loadSat()

    expect(await getApiToken()).toBeUndefined()
    expect(await getApiToken()).toBeUndefined()
    expect(await getApiToken()).toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-asks once the 503 cache window elapses', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 503 }))
    const { getApiToken } = await loadSat()

    await getApiToken()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(NO_PAT_CACHE_MS - 1)
    await getApiToken()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    await getApiToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('backs off on 429 instead of throwing, degrading to no token', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 429 }))
    const { getApiToken } = await loadSat()

    await expect(getApiToken()).resolves.toBeUndefined()
    await getApiToken()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(RATE_LIMIT_BACKOFF_MS - 1)
    await getApiToken()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    await getApiToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('honours a numeric Retry-After header on 429', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 429, headers: { 'retry-after': '30' } }))
    const { getApiToken } = await loadSat()

    await getApiToken()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(29_000)
    await getApiToken()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1_000)
    await getApiToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches a successful token and serves it without re-fetching', async () => {
    const expiry = Math.floor(Date.now() / 1000) + 3600
    fetchMock.mockResolvedValue(mockResponse({ status: 200, body: { token: 'tok-abc', expiry } }))
    const { getApiToken } = await loadSat()

    expect(await getApiToken()).toBe('tok-abc')
    expect(await getApiToken()).toBe('tok-abc')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still throws on an unexpected non-ok status (e.g. 500)', async () => {
    fetchMock.mockResolvedValue(mockResponse({ status: 500, body: 'boom' }))
    const { getApiToken } = await loadSat()

    await expect(getApiToken()).rejects.toThrow(/SAT exchange failed \(500\)/)
  })
})
