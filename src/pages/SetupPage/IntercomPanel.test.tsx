// @vitest-environment jsdom
/**
 * Component tests for the Setup Intercom tab (studio#254, OL-48).
 *
 * `fetch` is stubbed with a small router that mimics open-live's
 * intercom-connection routes (contract from open-live #617 / PR #618,
 * `docs/specs/intercom-connection.md` §2): the SAT exchange answers 503 (no
 * token, as in local dev), `GET/PUT/DELETE /api/v1/intercom-connection` keep a
 * singleton, and `POST /test` answers whatever the test configures. The real
 * API client, store and panel run unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ApiIntercomConnectionStatus,
  IntercomConnectionInput,
  IntercomConnectionTestInput,
  IntercomConnectionTestResult,
  IntercomTestStatus,
} from '@/lib/api'
import {
  INTERCOM_SOURCE_ENV_TEXT,
  INTERCOM_SOURCE_STORED_TEXT,
  INTERCOM_TEST_STATUS_LABELS,
  WHIP_KEY_NOT_VERIFIABLE_TEXT,
} from '@/lib/intercomConnection'
import { useIntercomConnectionStore } from '@/store/intercomConnection.store'
import { IntercomPanel } from './IntercomPanel'

const OSC_URL = 'https://acme.eyevinn-intercom-manager.auto.prod.osaas.io'
const DIRECT_URL = 'https://intercom.example.com'
const MANAGER_KEY_FIXTURE = 'fixture-manager-key-123'
const WHIP_KEY = 'whip-key-456'

function norm(url: string): string {
  const u = new URL(url)
  let path = u.pathname.replace(/\/+$/, '')
  if (!/\/api\/v1$/.test(path)) path = `${path}/api/v1`
  return `${u.origin}${path}`
}

function isOsc(url: string): boolean {
  return /(^|\.)osaas\.io$/.test(new URL(url).hostname)
}

const NONE: ApiIntercomConnectionStatus = {
  source: 'none',
  configured: false,
  url: null,
  mode: null,
  modeOverridden: false,
  tokenSet: false,
  whipKeySet: false,
  patSource: null,
  oscPatSet: true,
  problem: null,
  updatedAt: null,
}

interface Reply {
  status: number
  body?: unknown
}

/** Stored connection view (null = none stored). */
let stored: ApiIntercomConnectionStatus | null = null
/** Env fallback view (null = no env vars). */
let env: ApiIntercomConnectionStatus | null = null
let getReplies: Reply[] = []
let putReplies: Reply[] = []
/** Test reply per request; default mimics the backend's mode inference without network. */
let testReply: (body: IntercomConnectionTestInput) => Reply = defaultTestReply
const putBodies: IntercomConnectionInput[] = []
const testBodies: IntercomConnectionTestInput[] = []
let deleteCalls = 0
/** Every response body the panel received, to scan for secrets. */
const responseTexts: string[] = []

function current(): ApiIntercomConnectionStatus {
  return stored ?? env ?? NONE
}

function defaultTestReply(body: IntercomConnectionTestInput): Reply {
  const url = body.url ?? current().url
  if (!url) return { status: 200, body: { ok: false, status: 'not-configured', message: 'No intercom connection is configured', source: 'none' } }
  const mode = isOsc(url) ? 'osc' : 'direct'
  const source = body.url ? 'unsaved' : current().source
  if (mode === 'osc') {
    return {
      status: 200,
      body: { ok: true, status: 'ok', message: 'Connected: the intercom manager accepted the OSC service access token', httpStatus: 404, mode, patSource: 'OscAccessToken', url: norm(url), whipKey: 'not-used', source },
    }
  }
  const hasKey = body.apiKey !== undefined || (!body.url && current().tokenSet)
  if (!hasKey) {
    return { status: 200, body: { ok: false, status: 'missing-credential', message: 'No manager API key', mode, patSource: null, url: norm(url), whipKey: 'not-set', source } }
  }
  return { status: 200, body: { ok: true, status: 'ok', message: 'Connected', httpStatus: 404, mode, patSource: null, url: norm(url), whipKey: body.whipKey ? 'not-verifiable' : 'not-set', source } }
}

function json(status: number, body: unknown): Response {
  const text = JSON.stringify(body)
  responseTexts.push(text)
  return new Response(text, { status, headers: { 'Content-Type': 'application/json' } })
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input))
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname
  if (path === '/api/v1/auth/token') return json(503, { error: 'No PAT configured' })
  if (path === '/api/v1/intercom-connection' && method === 'GET') {
    const reply = getReplies.shift()
    if (reply) return json(reply.status, reply.body ?? {})
    return json(200, current())
  }
  if (path === '/api/v1/intercom-connection' && method === 'PUT') {
    const body = JSON.parse(String(init?.body ?? '{}')) as IntercomConnectionInput
    putBodies.push(body)
    const reply = putReplies.shift()
    if (reply) return json(reply.status, reply.body ?? {})
    const mode = isOsc(body.url) ? 'osc' : 'direct'
    if (mode === 'osc' && (body.apiKey !== undefined || body.whipKey)) {
      return json(400, { error: 'osc mode uses this instance’s OSC access token; do not send apiKey or whipKey', statusCode: 400 })
    }
    const sameOrigin = stored?.url ? new URL(stored.url).origin === new URL(norm(body.url)).origin : false
    const tokenSet = body.apiKey !== undefined || (sameOrigin && stored?.tokenSet === true)
    if (mode === 'direct' && !tokenSet) {
      return json(400, { error: 'apiKey is required for a direct-mode manager', statusCode: 400 })
    }
    const whipKeySet = mode === 'direct' && (body.whipKey === null ? false : body.whipKey !== undefined || (sameOrigin && stored?.whipKeySet === true))
    stored = {
      source: 'stored',
      configured: true,
      url: norm(body.url),
      mode,
      modeOverridden: false,
      tokenSet: mode === 'direct' && tokenSet,
      whipKeySet,
      patSource: mode === 'osc' ? 'OscAccessToken' : null,
      oscPatSet: true,
      problem: null,
      updatedAt: '2026-11-03T12:00:00.000Z',
    }
    return json(200, stored)
  }
  if (path === '/api/v1/intercom-connection' && method === 'DELETE') {
    deleteCalls++
    stored = null
    return new Response(null, { status: 204 })
  }
  if (path === '/api/v1/intercom-connection/test' && method === 'POST') {
    const body = JSON.parse(String(init?.body ?? '{}')) as IntercomConnectionTestInput
    testBodies.push(body)
    const reply = testReply(body)
    return json(reply.status, reply.body ?? {})
  }
  return json(404, { error: `Unhandled ${method} ${path}` })
})

const consoleSpies: ReturnType<typeof vi.spyOn>[] = []

beforeEach(() => {
  stored = null
  env = null
  getReplies = []
  putReplies = []
  testReply = defaultTestReply
  putBodies.length = 0
  testBodies.length = 0
  deleteCalls = 0
  responseTexts.length = 0
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  useIntercomConnectionStore.setState({ status: null, isLoading: false, loadError: null })
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) consoleSpies.push(vi.spyOn(console, m))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  for (const s of consoleSpies.splice(0)) s.mockRestore()
})

function urlInput(): HTMLInputElement {
  return screen.getByLabelText('Manager URL') as HTMLInputElement
}

async function headline(text: string) {
  await waitFor(() => expect(screen.getByTestId('intercom-status-headline').textContent).toBe(text))
}

async function testStatus(status: IntercomTestStatus) {
  await waitFor(() => expect(screen.getByTestId('intercom-test-status').textContent).toContain(INTERCOM_TEST_STATUS_LABELS[status]))
}

function setUrl(value: string) {
  fireEvent.change(urlInput(), { target: { value } })
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

/** Asserts no secret appears in the DOM, any input value, any response body or the console. */
function expectNoSecrets(...secrets: string[]) {
  const inputs = Array.from(document.querySelectorAll('input')).map((i) => i.value)
  const consoleArgs = consoleSpies.flatMap((s) => (s.mock.calls as unknown[][]).flat().map((a: unknown) => String(a)))
  for (const secret of secrets) {
    expect(document.body.innerHTML).not.toContain(secret)
    expect(inputs.some((v) => v.includes(secret))).toBe(false)
    expect(responseTexts.some((t) => t.includes(secret))).toBe(false)
    expect(consoleArgs.some((a) => a.includes(secret))).toBe(false)
  }
}

describe('IntercomPanel status', () => {
  it('shows "Not configured" and only the URL field when nothing is set', async () => {
    render(<IntercomPanel />)
    await headline('Not configured')
    expect(urlInput().value).toBe('')
    expect(screen.queryByLabelText('Manager API key')).toBeNull()
    expect(screen.queryByLabelText('WHIP key')).toBeNull()
    expect(screen.getByTestId('intercom-mode').textContent).toMatch(/not known yet/)
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('says an env connection comes from the environment, and a stored one overrides it', async () => {
    env = { ...NONE, source: 'env', configured: true, url: `${DIRECT_URL}/api/v1`, mode: 'direct', tokenSet: true }
    render(<IntercomPanel />)
    await headline('Configured')
    expect(screen.getByText(INTERCOM_SOURCE_ENV_TEXT)).toBeTruthy()
    expect(screen.getByText('source env')).toBeTruthy()
    // An env connection cannot be removed from Studio.
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()

    setUrl(OSC_URL)
    click('Save')
    await waitFor(() => expect(screen.getByText(INTERCOM_SOURCE_STORED_TEXT)).toBeTruthy())
    expect(screen.getByText('source stored')).toBeTruthy()
  })

  it('shows the backend problem when the connection is not usable', async () => {
    stored = {
      ...NONE,
      source: 'stored',
      url: `${OSC_URL}/api/v1`,
      mode: 'osc',
      oscPatSet: false,
      problem: 'osc mode needs the instance OSC access token (OscAccessToken / OSC_PAT), which is not set on this instance',
    }
    render(<IntercomPanel />)
    await headline('Not usable')
    expect(screen.getByTestId('intercom-status-problem').textContent).toMatch(/OscAccessToken/)
  })

  it('shows a 503 status read inline with Retry', async () => {
    getReplies = [{ status: 503, body: { error: 'Database unavailable', statusCode: 503 } }]
    render(<IntercomPanel />)
    await waitFor(() => expect(screen.getByTestId('intercom-load-error').textContent).toContain('Unavailable (503): Database unavailable'))
    click('Retry')
    await headline('Not configured')
  })

  it('shows a 401 status read inline', async () => {
    getReplies = [{ status: 401, body: { error: 'Unauthorized' } }]
    render(<IntercomPanel />)
    await waitFor(() => expect(screen.getByTestId('intercom-load-error').textContent).toContain('Not authorised (401)'))
  })
})

describe('IntercomPanel OSC flow', () => {
  it('saves only the URL and tests OK with mode osc without asking for a token', async () => {
    render(<IntercomPanel />)
    await headline('Not configured')
    setUrl(OSC_URL)
    click('Save')
    await headline('Configured')
    expect(putBodies).toEqual([{ url: OSC_URL }])
    expect(screen.getByText('mode osc')).toBeTruthy()

    click('Test connection')
    await testStatus('ok')
    // Untouched form after save: the connection in effect is tested.
    expect(testBodies).toEqual([{}])
    expect(screen.getByTestId('intercom-test-mode').textContent).toBe('osc')
    expect(screen.getByTestId('intercom-test-pat-source').textContent).toBe('OscAccessToken')
    expect(screen.queryByLabelText('Manager API key')).toBeNull()
    expect(screen.queryByLabelText('WHIP key')).toBeNull()
    expect(screen.queryByText('Advanced')).toBeNull()
  })

  it('tests an unsaved URL without changing the stored connection', async () => {
    render(<IntercomPanel />)
    await headline('Not configured')
    setUrl(OSC_URL)
    click('Test connection')
    await testStatus('ok')
    expect(testBodies).toEqual([{ url: OSC_URL }])
    expect(putBodies).toHaveLength(0)
    expect(deleteCalls).toBe(0)
    // The status is unchanged (also on a fresh read).
    cleanup()
    render(<IntercomPanel />)
    await headline('Not configured')
  })
})

describe('IntercomPanel direct flow', () => {
  it('shows the API key and, under Advanced, the WHIP key once the backend reports direct', async () => {
    render(<IntercomPanel />)
    await headline('Not configured')
    setUrl(DIRECT_URL)
    expect(screen.queryByLabelText('Manager API key')).toBeNull()
    click('Test connection')
    await testStatus('missing-credential')
    expect(screen.getByTestId('intercom-mode').textContent).toBe('Mode: direct (reported by open-live)')
    expect(screen.getByLabelText('Manager API key')).toBeTruthy()
    const whip = screen.getByLabelText('WHIP key')
    expect(whip.closest('details')?.querySelector('summary')?.textContent).toBe('Advanced')

    // Changing the URL to one with no reported mode hides the key fields again.
    setUrl('https://other.example.com')
    expect(screen.queryByLabelText('Manager API key')).toBeNull()
  })

  it('distinguishes a wrong key (auth failed) from an unreachable host', async () => {
    testReply = (body) => {
      if (body.url?.startsWith('https://down.')) {
        return { status: 200, body: { ok: false, status: 'unreachable', message: 'Could not reach the manager', mode: 'direct', patSource: null, url: norm(body.url), whipKey: 'not-set', source: 'unsaved' } }
      }
      if (body.apiKey) {
        return { status: 200, body: { ok: false, status: 'auth-failed', message: 'The manager refused the API key', httpStatus: 401, mode: 'direct', patSource: null, url: norm(body.url!), whipKey: 'not-set', source: 'unsaved' } }
      }
      return defaultTestReply(body)
    }
    render(<IntercomPanel />)
    await headline('Not configured')
    setUrl(DIRECT_URL)
    click('Test connection')
    await testStatus('missing-credential')
    fireEvent.change(screen.getByLabelText('Manager API key'), { target: { value: 'wrong-key' } })
    click('Test connection')
    await testStatus('auth-failed')
    expect(screen.getByTestId('intercom-test-status').textContent).toBe('Authentication failed (HTTP 401)')
    expect(testBodies[1]).toEqual({ url: DIRECT_URL, apiKey: 'wrong-key' })

    setUrl('https://down.example.com')
    click('Test connection')
    await testStatus('unreachable')
    expect(screen.getByTestId('intercom-test-status').textContent).toBe('Unreachable')
    // The key typed for the other URL is not sent to this host (mode unknown for it).
    expect(testBodies[2]).toEqual({ url: 'https://down.example.com' })
  })

  it('learns the mode when a URL-only save is refused for a direct manager', async () => {
    render(<IntercomPanel />)
    await headline('Not configured')
    setUrl(DIRECT_URL)
    click('Save')
    await waitFor(() => expect(screen.getByTestId('intercom-save-error').textContent).toMatch(/apiKey is required/))
    await waitFor(() => expect(screen.getByLabelText('Manager API key')).toBeTruthy())
    expect(putBodies).toEqual([{ url: DIRECT_URL }])
  })

  it('never shows, prefills or logs the keys after saving; reopening shows "set"', async () => {
    render(<IntercomPanel />)
    await headline('Not configured')
    setUrl(DIRECT_URL)
    click('Test connection')
    await testStatus('missing-credential')
    fireEvent.change(screen.getByLabelText('Manager API key'), { target: { value: MANAGER_KEY_FIXTURE } })
    fireEvent.change(screen.getByLabelText('WHIP key'), { target: { value: WHIP_KEY } })
    click('Test connection')
    await testStatus('ok')
    expect(screen.getByTestId('intercom-test-whip').textContent).toBe(WHIP_KEY_NOT_VERIFIABLE_TEXT)

    click('Save')
    await headline('Configured')
    expect(putBodies).toEqual([{ url: DIRECT_URL, apiKey: MANAGER_KEY_FIXTURE, whipKey: WHIP_KEY }])
    expect(screen.getByTestId('intercom-status-api-key').textContent).toBe('set')
    expect(screen.getByTestId('intercom-status-whip-key').textContent).toBe('set')
    expect((screen.getByLabelText('Manager API key') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('WHIP key') as HTMLInputElement).value).toBe('')
    expectNoSecrets(MANAGER_KEY_FIXTURE, WHIP_KEY)

    // Reopen the tab.
    cleanup()
    render(<IntercomPanel />)
    await headline('Configured')
    expect(screen.getByTestId('intercom-status-api-key').textContent).toBe('set')
    const apiKey = screen.getByLabelText('Manager API key') as HTMLInputElement
    expect(apiKey.value).toBe('')
    expect(apiKey.type).toBe('password')
    expect(apiKey.placeholder).toBe('API key set (leave empty to keep it)')
    expectNoSecrets(MANAGER_KEY_FIXTURE, WHIP_KEY)

    // Saving again without typing keeps the stored keys (omitted from the body).
    click('Save')
    await waitFor(() => expect(putBodies).toHaveLength(2))
    expect(putBodies[1]).toEqual({ url: `${DIRECT_URL}/api/v1` })
  })

  it('clears the stored WHIP key with null when asked', async () => {
    stored = { ...NONE, source: 'stored', configured: true, url: `${DIRECT_URL}/api/v1`, mode: 'direct', tokenSet: true, whipKeySet: true }
    render(<IntercomPanel />)
    await headline('Configured')
    fireEvent.click(screen.getByLabelText('Remove the stored WHIP key on save'))
    click('Save')
    await waitFor(() => expect(screen.getByTestId('intercom-status-whip-key').textContent).toBe('not set'))
    expect(putBodies).toEqual([{ url: `${DIRECT_URL}/api/v1`, whipKey: null }])
  })
})

describe('IntercomPanel test results', () => {
  const cases: { status: IntercomTestStatus; body: IntercomConnectionTestResult }[] = [
    { status: 'ok', body: { ok: true, status: 'ok', message: 'Connected', mode: 'osc', patSource: 'OscAccessToken', url: `${OSC_URL}/api/v1`, whipKey: 'not-used', source: 'stored' } },
    { status: 'unreachable', body: { ok: false, status: 'unreachable', message: 'Timed out', mode: 'osc', patSource: 'OscAccessToken', url: `${OSC_URL}/api/v1`, whipKey: 'not-used', source: 'stored' } },
    { status: 'auth-failed', body: { ok: false, status: 'auth-failed', message: 'SAT refused', httpStatus: 403, mode: 'osc', patSource: 'OscAccessToken', url: `${OSC_URL}/api/v1`, whipKey: 'not-used', source: 'stored' } },
    { status: 'sat-exchange-failed', body: { ok: false, status: 'sat-exchange-failed', message: 'Token service refused the PAT', httpStatus: 401, mode: 'osc', patSource: 'OscAccessToken', url: `${OSC_URL}/api/v1`, whipKey: 'not-used', source: 'stored' } },
    { status: 'missing-credential', body: { ok: false, status: 'missing-credential', message: 'No oscPat', mode: 'osc', patSource: null, url: `${OSC_URL}/api/v1`, whipKey: 'not-used', source: 'stored' } },
    { status: 'unexpected-response', body: { ok: false, status: 'unexpected-response', message: 'Not an intercom manager', httpStatus: 302, mode: 'osc', patSource: 'OscAccessToken', url: `${OSC_URL}/api/v1`, whipKey: 'not-used', source: 'stored' } },
    { status: 'not-configured', body: { ok: false, status: 'not-configured', message: 'No intercom connection is configured', source: 'none' } },
  ]

  for (const c of cases) {
    it(`shows ${c.status} with the backend message`, async () => {
      testReply = () => ({ status: 200, body: c.body })
      render(<IntercomPanel />)
      await headline('Not configured')
      click('Test connection')
      await testStatus(c.status)
      expect(screen.getByText(c.body.message)).toBeTruthy()
      if (c.body.httpStatus !== undefined && c.status !== 'ok') {
        expect(screen.getByTestId('intercom-test-status').textContent).toContain(`HTTP ${c.body.httpStatus}`)
      }
    })
  }

  it('shows a 400 refusal inline with the TRUSTED_INTERCOM_HOSTS hint', async () => {
    testReply = () => ({ status: 400, body: { error: 'Manager host 10.0.0.5 is a private address; add it to TRUSTED_INTERCOM_HOSTS', statusCode: 400 } })
    render(<IntercomPanel />)
    await headline('Not configured')
    setUrl('http://10.0.0.5:8000')
    click('Test connection')
    await waitFor(() => expect(screen.getByTestId('intercom-test-error').textContent).toMatch(/TRUSTED_INTERCOM_HOSTS/))
    expect(screen.getByText(/server administrator must add the manager host/)).toBeTruthy()
  })
})

describe('IntercomPanel save and remove errors', () => {
  it('shows a 409 and a 503 save failure inline', async () => {
    putReplies = [
      { status: 409, body: { error: 'The intercom connection was changed concurrently; retry', statusCode: 409 } },
      { status: 503, body: { error: 'Database unavailable', statusCode: 503 } },
    ]
    render(<IntercomPanel />)
    await headline('Not configured')
    setUrl(OSC_URL)
    click('Save')
    await waitFor(() => expect(screen.getByTestId('intercom-save-error').textContent).toMatch(/try again/))
    click('Save')
    await waitFor(() => expect(screen.getByTestId('intercom-save-error').textContent).toBe('Unavailable (503): Database unavailable'))
    await headline('Not configured')
  })

  it('removes the stored connection after a confirm; env applies again', async () => {
    stored = { ...NONE, source: 'stored', configured: true, url: `${OSC_URL}/api/v1`, mode: 'osc', patSource: 'OscAccessToken' }
    env = { ...NONE, source: 'env', configured: true, url: `${DIRECT_URL}/api/v1`, mode: 'direct', tokenSet: true }
    render(<IntercomPanel />)
    await headline('Configured')
    click('Remove')
    expect(deleteCalls).toBe(0)
    // Cancel keeps it.
    click('Cancel')
    expect(deleteCalls).toBe(0)
    click('Remove')
    const buttons = screen.getAllByRole('button', { name: 'Remove' })
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() => expect(screen.getByText(INTERCOM_SOURCE_ENV_TEXT)).toBeTruthy())
    expect(deleteCalls).toBe(1)
    expect(urlInput().value).toBe(`${DIRECT_URL}/api/v1`)
  })
})
