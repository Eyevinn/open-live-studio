// ─── Storage connection form helpers (studio#217, OL-21b.1) ──────────────────
// Pure helpers behind the Setup Storage tab, kept out of the component so the
// write-only secret handling is unit-testable. The secret key is NEVER read
// back from the API (only `secretKeySet` is), never logged and never toasted;
// these helpers only ever put it in a request body when the operator typed one.
import type {
  ApiStorageConnection,
  StorageConnectionCreateInput,
  StorageConnectionPatchInput,
  StorageConnectionRole,
  StorageConnectionTestResult,
} from '@/lib/api'
import { ApiError, DEFAULT_STORAGE_CONNECTION_ID } from '@/lib/api'

export const STORAGE_ROLE_LABELS: Record<StorageConnectionRole, string> = {
  clip: 'Clips',
  recording: 'Recordings',
  both: 'Clips and recordings',
}

export interface StorageConnectionForm {
  name: string
  endpoint: string
  region: string
  useSsl: boolean
  accessKey: string
  /** Write-only. Empty on edit; only sent when the operator typed a new one. */
  secretKey: string
  defaultBucket: string
  role: StorageConnectionRole
}

export const emptyStorageConnectionForm: StorageConnectionForm = {
  name: '',
  endpoint: '',
  region: '',
  useSsl: true,
  accessKey: '',
  secretKey: '',
  defaultBucket: '',
  role: 'both',
}

/** Seeds the edit form from a stored connection. The secret is always empty. */
export function formFromConnection(c: ApiStorageConnection): StorageConnectionForm {
  return {
    name: c.name,
    endpoint: c.endpoint,
    region: c.region ?? '',
    useSsl: c.useSsl,
    accessKey: c.accessKey,
    secretKey: '',
    defaultBucket: c.defaultBucket ?? '',
    role: c.role,
  }
}

/**
 * Validates the form. `original` is the stored connection when editing (the
 * secret is then optional, and a default bucket cannot be removed because the
 * backend PATCH has no way to clear it). Returns an error string or null.
 */
export function validateStorageConnectionForm(
  form: StorageConnectionForm,
  original?: ApiStorageConnection,
): string | null {
  if (!form.name.trim()) return 'Name is required'
  if (!form.endpoint.trim()) return 'Endpoint is required'
  if (!form.accessKey.trim()) return 'Access key is required'
  if (!original && !form.secretKey) return 'Secret key is required'
  if (form.region.trim().length > 64) return 'Region must be at most 64 characters'
  if (original?.defaultBucket && !form.defaultBucket.trim()) {
    return 'The default bucket cannot be removed once set; enter a bucket name instead'
  }
  return null
}

/** Builds the `POST` body. Optional fields are omitted when empty. */
export function buildCreateInput(form: StorageConnectionForm): StorageConnectionCreateInput {
  return {
    name: form.name.trim(),
    endpoint: form.endpoint.trim(),
    accessKey: form.accessKey.trim(),
    secretKey: form.secretKey,
    useSsl: form.useSsl,
    role: form.role,
    ...(form.region.trim() ? { region: form.region.trim() } : {}),
    ...(form.defaultBucket.trim() ? { defaultBucket: form.defaultBucket.trim() } : {}),
  }
}

/**
 * Builds the `PATCH` body with only the fields the operator changed (plus
 * `useSsl` whenever `endpoint` changed, see below). The secret is included only when a new one was typed; otherwise the key is
 * absent so the backend keeps the stored ciphertext.
 */
export function buildPatchInput(
  form: StorageConnectionForm,
  original: ApiStorageConnection,
): StorageConnectionPatchInput {
  const patch: StorageConnectionPatchInput = {}
  const name = form.name.trim()
  const endpoint = form.endpoint.trim()
  const region = form.region.trim()
  const accessKey = form.accessKey.trim()
  const bucket = form.defaultBucket.trim()
  if (name !== original.name) patch.name = name
  if (endpoint !== original.endpoint) patch.endpoint = endpoint
  // The backend re-derives `useSsl` whenever `endpoint` is patched and defaults
  // the hint to true, so a scheme-less endpoint change without `useSsl` would
  // silently turn SSL on. Always send the checkbox alongside a new endpoint.
  if (patch.endpoint !== undefined || form.useSsl !== original.useSsl) patch.useSsl = form.useSsl
  if (region && region !== original.region) patch.region = region
  if (accessKey !== original.accessKey) patch.accessKey = accessKey
  if (bucket && bucket !== (original.defaultBucket ?? '')) patch.defaultBucket = bucket
  if (form.role !== original.role) patch.role = form.role
  if (form.secretKey) patch.secretKey = form.secretKey
  return patch
}

/** True when the backend rejected the endpoint by the TRUSTED_STORAGE_HOSTS gate. */
export function isUntrustedEndpointError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /TRUSTED_STORAGE_HOSTS/.test(err.message)
}

/**
 * Readable message for a failed save. A zod validation 400 has the generic
 * `error` "Validation error" plus `issues`; their paths and messages are shown
 * (zod issues carry no input values, so no secret can leak through them).
 */
export function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = (err.body as { issues?: { path?: (string | number)[]; message?: string }[] } | undefined)?.issues
    if (Array.isArray(issues) && issues.length > 0) {
      const detail = issues
        .map((i) => `${(i.path ?? []).join('.') || 'body'}: ${i.message ?? 'invalid'}`)
        .join('; ')
      return `${err.message}: ${detail}`
    }
    return err.message
  }
  return 'Failed to save the storage connection'
}

export type TestOutcome = 'success' | 'warning' | 'error'

/** Classifies a probe result: `auth: forbidden` is a warning, not success. */
export function testOutcome(r: StorageConnectionTestResult): TestOutcome {
  if (r.reachable && r.auth === 'ok' && r.bucket === 'found') return 'success'
  if (r.reachable && r.auth === 'forbidden') return 'warning'
  return 'error'
}

/** Connections offered by the clip picker: default plus role `clip`/`both`. */
export function clipPickerConnections(all: ApiStorageConnection[]): ApiStorageConnection[] {
  return all.filter((c) => c.id !== DEFAULT_STORAGE_CONNECTION_ID && (c.role === 'clip' || c.role === 'both'))
}
