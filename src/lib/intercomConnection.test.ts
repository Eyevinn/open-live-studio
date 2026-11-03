import { describe, expect, it, vi } from 'vitest'

// api.ts reads `window._env_` and the SAT auth on import; stub both so the real
// ApiError class can be loaded in the node test environment.
vi.mock('./base.js', () => ({ BASE: 'http://test' }))
vi.mock('./sat.js', () => ({ authenticateWithOpenLive: vi.fn(), getApiToken: vi.fn() }))

import { ApiError, type ApiIntercomConnectionStatus, type IntercomConnectionTestResult } from './api'
import {
  INTERCOM_NOT_CONFIGURED_TEXT,
  INTERCOM_SOURCE_ENV_TEXT,
  INTERCOM_SOURCE_STORED_TEXT,
  WHIP_KEY_NOT_VERIFIABLE_TEXT,
  buildSaveInput,
  buildTestInput,
  emptyIntercomConnectionForm,
  formFromStatus,
  intercomErrorMessage,
  intercomTestOutcome,
  isFormUntouched,
  isUntrustedHostError,
  managerOrigin,
  modeForUrl,
  normalizeManagerUrl,
  rememberMode,
  sourceText,
  validateIntercomConnectionForm,
  whipKeyNote,
} from './intercomConnection'

const OSC_URL = 'https://acme.eyevinn-intercom-manager.auto.prod.osaas.io'

function status(overrides: Partial<ApiIntercomConnectionStatus> = {}): ApiIntercomConnectionStatus {
  return {
    source: 'stored',
    configured: true,
    url: `${OSC_URL}/api/v1`,
    mode: 'osc',
    modeOverridden: false,
    tokenSet: false,
    whipKeySet: false,
    patSource: 'OscAccessToken',
    oscPatSet: true,
    problem: null,
    updatedAt: '2026-11-03T10:00:00.000Z',
    ...overrides,
  }
}

function result(overrides: Partial<IntercomConnectionTestResult> = {}): IntercomConnectionTestResult {
  return { ok: true, status: 'ok', message: 'Connected', mode: 'osc', source: 'unsaved', ...overrides }
}

describe('normalizeManagerUrl', () => {
  it('mirrors the backend normalisation', () => {
    expect(normalizeManagerUrl(OSC_URL)).toBe(`${OSC_URL}/api/v1`)
    expect(normalizeManagerUrl(`${OSC_URL}/api/v1/`)).toBe(`${OSC_URL}/api/v1`)
    expect(normalizeManagerUrl(`  ${OSC_URL}//  `)).toBe(`${OSC_URL}/api/v1`)
    expect(normalizeManagerUrl('https://Intercom.Example.com/base')).toBe('https://intercom.example.com/base/api/v1')
  })

  it('returns null for empty, unparsable or non-http URLs', () => {
    expect(normalizeManagerUrl('')).toBeNull()
    expect(normalizeManagerUrl('not a url')).toBeNull()
    expect(normalizeManagerUrl('ftp://x.example.com')).toBeNull()
  })

  it('managerOrigin gives the origin', () => {
    expect(managerOrigin(`${OSC_URL}/api/v1`)).toBe(OSC_URL)
    expect(managerOrigin(null)).toBeNull()
  })
})

describe('known modes', () => {
  it('only knows a mode the backend reported for the same normalised URL', () => {
    let known = rememberMode({}, `${OSC_URL}/api/v1`, 'osc')
    expect(modeForUrl(known, OSC_URL)).toBe('osc')
    expect(modeForUrl(known, 'https://other.osaas.io')).toBeNull()
    known = rememberMode(known, 'https://intercom.example.com', 'direct')
    expect(modeForUrl(known, 'https://intercom.example.com/api/v1/')).toBe('direct')
  })

  it('ignores missing urls or modes', () => {
    const known = {}
    expect(rememberMode(known, null, 'osc')).toBe(known)
    expect(rememberMode(known, OSC_URL, null)).toBe(known)
    expect(rememberMode(known, OSC_URL, undefined)).toBe(known)
  })
})

describe('form', () => {
  it('seeds only the URL, never a key', () => {
    expect(formFromStatus(status({ tokenSet: true, whipKeySet: true }))).toEqual({
      ...emptyIntercomConnectionForm,
      url: `${OSC_URL}/api/v1`,
    })
    expect(formFromStatus(null)).toEqual(emptyIntercomConnectionForm)
  })

  it('validates the URL', () => {
    expect(validateIntercomConnectionForm({ ...emptyIntercomConnectionForm })).toBe('Manager URL is required')
    expect(validateIntercomConnectionForm({ ...emptyIntercomConnectionForm, url: 'nope' })).toMatch(/valid/)
    expect(validateIntercomConnectionForm({ ...emptyIntercomConnectionForm, url: OSC_URL })).toBeNull()
  })

  it('is untouched while it shows the connection in effect', () => {
    const s = status()
    expect(isFormUntouched(formFromStatus(s), s)).toBe(true)
    expect(isFormUntouched({ ...formFromStatus(s), url: `${OSC_URL}/` }, s)).toBe(true)
    expect(isFormUntouched({ ...formFromStatus(s), url: 'https://other.osaas.io' }, s)).toBe(false)
    expect(isFormUntouched({ ...formFromStatus(s), apiKey: 'k' }, s)).toBe(false)
    expect(isFormUntouched({ ...emptyIntercomConnectionForm, url: OSC_URL }, null)).toBe(false)
  })
})

describe('buildSaveInput', () => {
  const form = { url: ` ${OSC_URL} `, apiKey: 'secret-api', whipKey: 'secret-whip', clearWhipKey: false }

  it('sends only the URL when the mode is osc or not known (never the mode)', () => {
    expect(buildSaveInput(form, 'osc')).toEqual({ url: OSC_URL })
    expect(buildSaveInput(form, null)).toEqual({ url: OSC_URL })
  })

  it('sends typed keys in direct mode and omits untyped ones', () => {
    expect(buildSaveInput(form, 'direct')).toEqual({ url: OSC_URL, apiKey: 'secret-api', whipKey: 'secret-whip' })
    expect(buildSaveInput({ ...form, apiKey: '', whipKey: '' }, 'direct')).toEqual({ url: OSC_URL })
  })

  it('clears the WHIP key with null only when asked', () => {
    expect(buildSaveInput({ ...form, whipKey: '', clearWhipKey: true }, 'direct')).toEqual({
      url: OSC_URL,
      apiKey: 'secret-api',
      whipKey: null,
    })
  })
})

describe('buildTestInput', () => {
  it('tests the connection in effect when untouched or empty', () => {
    const s = status()
    expect(buildTestInput(formFromStatus(s), 'osc', s)).toEqual({})
    expect(buildTestInput({ ...emptyIntercomConnectionForm }, null, s)).toEqual({})
    expect(buildTestInput({ ...emptyIntercomConnectionForm }, null, null)).toEqual({})
  })

  it('sends unsaved values, keys only in direct mode', () => {
    const form = { url: 'https://intercom.example.com', apiKey: 'k', whipKey: 'w', clearWhipKey: false }
    expect(buildTestInput(form, null, null)).toEqual({ url: 'https://intercom.example.com' })
    expect(buildTestInput(form, 'osc', null)).toEqual({ url: 'https://intercom.example.com' })
    expect(buildTestInput(form, 'direct', null)).toEqual({ url: 'https://intercom.example.com', apiKey: 'k', whipKey: 'w' })
  })
})

describe('results and status text', () => {
  it('classifies all seven statuses', () => {
    expect(intercomTestOutcome(result())).toBe('success')
    for (const s of ['unreachable', 'auth-failed', 'sat-exchange-failed', 'unexpected-response'] as const) {
      expect(intercomTestOutcome(result({ ok: false, status: s }))).toBe('error')
    }
    expect(intercomTestOutcome(result({ ok: false, status: 'missing-credential' }))).toBe('warning')
    expect(intercomTestOutcome({ ok: false, status: 'not-configured', message: 'x', source: 'none' })).toBe('warning')
  })

  it('notes the WHIP key', () => {
    expect(whipKeyNote(result({ whipKey: 'not-verifiable' }))).toBe(WHIP_KEY_NOT_VERIFIABLE_TEXT)
    expect(whipKeyNote(result({ whipKey: 'not-set' }))).toBe('No WHIP key set')
    expect(whipKeyNote(result({ whipKey: 'not-used' }))).toBeNull()
  })

  it('describes the source', () => {
    expect(sourceText(status({ source: 'env' }))).toBe(INTERCOM_SOURCE_ENV_TEXT)
    expect(sourceText(status())).toBe(INTERCOM_SOURCE_STORED_TEXT)
    expect(sourceText(status({ source: 'none' }))).toBe(INTERCOM_NOT_CONFIGURED_TEXT)
  })
})

describe('errors', () => {
  it('names 401, 503 and 409 and keeps 400 messages', () => {
    expect(intercomErrorMessage(new ApiError('Unauthorized', 401), 'f')).toBe('Not authorised (401): Unauthorized')
    expect(intercomErrorMessage(new ApiError('Database unavailable', 503), 'f')).toBe('Unavailable (503): Database unavailable')
    expect(intercomErrorMessage(new ApiError('changed concurrently; retry', 409), 'f')).toMatch(/try again/)
    expect(intercomErrorMessage(new ApiError('Manager URL is not a valid URL', 400), 'f')).toBe('Manager URL is not a valid URL')
    expect(intercomErrorMessage(new Error('boom'), 'fallback')).toBe('fallback')
  })

  it('appends zod issues', () => {
    const err = new ApiError('Validation error', 400, { issues: [{ path: ['url'], message: 'Required' }] })
    expect(intercomErrorMessage(err, 'f')).toBe('Validation error: url: Required')
  })

  it('detects the TRUSTED_INTERCOM_HOSTS refusal', () => {
    expect(isUntrustedHostError(new ApiError('private address; add it to TRUSTED_INTERCOM_HOSTS', 400))).toBe(true)
    expect(isUntrustedHostError(new ApiError('other', 400))).toBe(false)
  })
})
