// ─── Intercom connection form helpers (studio#254, OL-48) ────────────────────
// Pure helpers behind the Setup Intercom tab, kept out of the component so the
// mode-dependent fields and the write-only secret handling are unit-testable.
//
// Studio never infers the auth mode: it only shows the `mode` the backend
// returned (status read or Test) for a given manager URL. The manager API key
// and WHIP key are never read back (only `tokenSet` / `whipKeySet` are), never
// logged and never toasted; they are only put in a request body when the
// operator typed one and the backend-reported mode for that URL is `direct`.
import type {
  ApiIntercomConnectionStatus,
  IntercomConnectionInput,
  IntercomConnectionMode,
  IntercomConnectionTestInput,
  IntercomConnectionTestResult,
  IntercomTestStatus,
} from '@/lib/api'
import { ApiError } from '@/lib/api'

export interface IntercomConnectionForm {
  url: string
  /** Write-only. Never prefilled; only sent in `direct` mode when typed. */
  apiKey: string
  /** Write-only. Never prefilled; only sent in `direct` mode when typed. */
  whipKey: string
  /** `direct` only: clear the stored WHIP key on save (`whipKey: null`). */
  clearWhipKey: boolean
}

export const emptyIntercomConnectionForm: IntercomConnectionForm = {
  url: '',
  apiKey: '',
  whipKey: '',
  clearWhipKey: false,
}

/** Seeds the form from the status view. The URL is not secret; the keys are always empty. */
export function formFromStatus(status: ApiIntercomConnectionStatus | null): IntercomConnectionForm {
  return { ...emptyIntercomConnectionForm, url: status?.url ?? '' }
}

/**
 * Canonical form of a manager URL, mirroring open-live's
 * `normalizeIntercomManagerUrl` (origin + path without trailing slashes, ending
 * in `/api/v1`). Used only to match the form's URL against a URL the backend
 * already reported a mode for, never to decide a mode. Null when unparsable.
 */
export function normalizeManagerUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  let path = parsed.pathname.replace(/\/+$/, '')
  if (!/\/api\/v1$/.test(path)) path = `${path}/api/v1`
  return `${parsed.origin}${path}`
}

/** Origin of a manager URL, or null when unparsable. */
export function managerOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null
  const n = normalizeManagerUrl(raw)
  return n ? new URL(n).origin : null
}

/** Backend-reported modes, keyed by normalised manager URL. */
export type KnownModes = Record<string, IntercomConnectionMode>

/** Records the mode the backend reported for `url` (no-op when either is missing). */
export function rememberMode(
  known: KnownModes,
  url: string | null | undefined,
  mode: IntercomConnectionMode | null | undefined,
): KnownModes {
  const key = url ? normalizeManagerUrl(url) : null
  if (!key || !mode) return known
  if (known[key] === mode) return known
  return { ...known, [key]: mode }
}

/** The backend-reported mode for the form's URL, or null when none was returned yet. */
export function modeForUrl(known: KnownModes, url: string): IntercomConnectionMode | null {
  const key = normalizeManagerUrl(url)
  return key ? known[key] ?? null : null
}

/** True when the form still shows the connection in effect (same URL, no key typed). */
export function isFormUntouched(form: IntercomConnectionForm, status: ApiIntercomConnectionStatus | null): boolean {
  if (form.apiKey || form.whipKey || form.clearWhipKey) return false
  const url = form.url.trim()
  if (!url) return true
  return normalizeManagerUrl(url) === (status?.url ? normalizeManagerUrl(status.url) : null)
}

/** Validates the form for Save. Returns an error string or null. */
export function validateIntercomConnectionForm(form: IntercomConnectionForm): string | null {
  const url = form.url.trim()
  if (!url) return 'Manager URL is required'
  if (!normalizeManagerUrl(url)) return 'Manager URL must be a valid http(s) URL'
  return null
}

/**
 * Builds the `PUT` body. `mode` is never sent (the backend infers it). Keys
 * are only included in `direct` mode, and only when typed: omitting them keeps
 * the stored ones for the same manager origin.
 */
export function buildSaveInput(
  form: IntercomConnectionForm,
  mode: IntercomConnectionMode | null,
): IntercomConnectionInput {
  const body: IntercomConnectionInput = { url: form.url.trim() }
  if (mode !== 'direct') return body
  if (form.apiKey) body.apiKey = form.apiKey
  if (form.whipKey) body.whipKey = form.whipKey
  else if (form.clearWhipKey) body.whipKey = null
  return body
}

/**
 * Builds the `POST /test` body from the UNSAVED form. An untouched form (or an
 * empty URL) tests the connection in effect with `{}`. Keys are only sent in
 * `direct` mode, so a key typed for an earlier URL is never sent to another.
 */
export function buildTestInput(
  form: IntercomConnectionForm,
  mode: IntercomConnectionMode | null,
  status: ApiIntercomConnectionStatus | null,
): IntercomConnectionTestInput {
  const url = form.url.trim()
  if (!url || isFormUntouched(form, status)) return {}
  const body: IntercomConnectionTestInput = { url }
  if (mode !== 'direct') return body
  if (form.apiKey) body.apiKey = form.apiKey
  if (form.whipKey) body.whipKey = form.whipKey
  return body
}

export const INTERCOM_TEST_STATUS_LABELS: Record<IntercomTestStatus, string> = {
  ok: 'OK',
  unreachable: 'Unreachable',
  'auth-failed': 'Authentication failed',
  'sat-exchange-failed': 'SAT exchange failed',
  'missing-credential': 'Missing credential',
  'unexpected-response': 'Unexpected response',
  'not-configured': 'Not configured',
}

export type IntercomTestOutcome = 'success' | 'warning' | 'error'

/**
 * Tone of a test result. `missing-credential` / `not-configured` are warnings:
 * no network call was made, the operator still has to enter something.
 */
export function intercomTestOutcome(r: IntercomConnectionTestResult): IntercomTestOutcome {
  if (r.ok && r.status === 'ok') return 'success'
  if (r.status === 'missing-credential' || r.status === 'not-configured') return 'warning'
  return 'error'
}

export const WHIP_KEY_NOT_VERIFIABLE_TEXT = 'WHIP key could not be verified'

/** Note about the WHIP key in a test result, or null. */
export function whipKeyNote(r: IntercomConnectionTestResult): string | null {
  if (r.whipKey === 'not-verifiable') return WHIP_KEY_NOT_VERIFIABLE_TEXT
  if (r.whipKey === 'not-set') return 'No WHIP key set'
  return null
}

export const INTERCOM_NOT_CONFIGURED_TEXT = 'Not configured'
export const INTERCOM_SOURCE_ENV_TEXT = 'The connection comes from the environment (INTERCOM_MANAGER_* variables)'
export const INTERCOM_SOURCE_STORED_TEXT = 'Stored connection; it overrides any environment configuration'

/** Plain-language line for the status `source`. */
export function sourceText(status: ApiIntercomConnectionStatus): string {
  if (status.source === 'env') return INTERCOM_SOURCE_ENV_TEXT
  if (status.source === 'stored') return INTERCOM_SOURCE_STORED_TEXT
  return INTERCOM_NOT_CONFIGURED_TEXT
}

/** True when the backend rejected the URL by the TRUSTED_INTERCOM_HOSTS gate. */
export function isUntrustedHostError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /TRUSTED_INTERCOM_HOSTS/.test(err.message)
}

/**
 * Readable inline message for a failed API call. Shows the backend message
 * (which never contains a secret) and names 401 / 503 / 409 explicitly. A zod
 * validation 400 has `issues` whose paths and messages are appended (zod
 * issues carry no input values, so no key can leak through them).
 */
export function intercomErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback
  if (err.status === 401) return `Not authorised (401): ${err.message}`
  if (err.status === 503) return `Unavailable (503): ${err.message}`
  if (err.status === 409) return `${err.message} (another change was saved at the same time; try again)`
  const issues = (err.body as { issues?: { path?: (string | number)[]; message?: string }[] } | undefined)?.issues
  if (Array.isArray(issues) && issues.length > 0) {
    const detail = issues
      .map((i) => `${(i.path ?? []).join('.') || 'body'}: ${i.message ?? 'invalid'}`)
      .join('; ')
    return `${err.message}: ${detail}`
  }
  return err.message
}
