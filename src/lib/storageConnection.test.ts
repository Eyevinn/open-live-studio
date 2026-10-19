import { describe, expect, it, vi } from 'vitest'

// api.ts reads `window._env_` and the SAT auth on import; stub both so the real
// ApiError class can be loaded in the node test environment.
vi.mock('./base.js', () => ({ BASE: 'http://test' }))
vi.mock('./sat.js', () => ({ authenticateWithOpenLive: vi.fn(), getApiToken: vi.fn() }))

import { ApiError, type ApiStorageConnection, type StorageConnectionTestResult } from './api'
import {
  buildCreateInput,
  buildPatchInput,
  clipPickerConnections,
  emptyStorageConnectionForm,
  formFromConnection,
  isUntrustedEndpointError,
  saveErrorMessage,
  testOutcome,
  validateStorageConnectionForm,
} from './storageConnection'

function conn(overrides: Partial<ApiStorageConnection> = {}): ApiStorageConnection {
  return {
    id: 'stconn-1', name: 'C', endpoint: 's3.example.com', region: 'us-east-1', useSsl: true,
    role: 'both', accessKey: 'AK', secretKeySet: true, createdAt: null, updatedAt: null, ...overrides,
  }
}

function result(overrides: Partial<StorageConnectionTestResult>): StorageConnectionTestResult {
  return { checkedFrom: 'open-live', reachable: true, auth: 'ok', bucket: 'found', canList: true, message: 'm', ...overrides }
}

describe('storage connection form helpers', () => {
  it('never seeds the secret on edit', () => {
    expect(formFromConnection(conn()).secretKey).toBe('')
  })

  it('requires a secret on create but not on edit', () => {
    const form = { ...emptyStorageConnectionForm, name: 'n', endpoint: 'e', accessKey: 'a' }
    expect(validateStorageConnectionForm(form)).toBe('Secret key is required')
    expect(validateStorageConnectionForm(form, conn())).toBeNull()
  })

  it('refuses to clear a default bucket (PATCH cannot remove it)', () => {
    const original = conn({ defaultBucket: 'clips' })
    expect(validateStorageConnectionForm({ ...formFromConnection(original), defaultBucket: '' }, original)).toMatch(/cannot be removed/)
  })

  it('omits empty optional fields on create', () => {
    const body = buildCreateInput({ ...emptyStorageConnectionForm, name: ' n ', endpoint: 'e', accessKey: 'a', secretKey: 's' })
    expect(body).toEqual({ name: 'n', endpoint: 'e', accessKey: 'a', secretKey: 's', useSsl: true, role: 'both' })
  })

  it('builds an empty patch when nothing changed', () => {
    const original = conn({ defaultBucket: 'clips' })
    expect(buildPatchInput(formFromConnection(original), original)).toEqual({})
  })

  it('sends useSsl with a changed endpoint so the backend does not default it to true', () => {
    const original = conn({ endpoint: 'minio.internal:9000', useSsl: false })
    const patch = buildPatchInput({ ...formFromConnection(original), endpoint: 'minio2.internal:9000' }, original)
    expect(patch).toEqual({ endpoint: 'minio2.internal:9000', useSsl: false })
  })

  it('sends useSsl alone when only the checkbox changed', () => {
    const original = conn({ useSsl: true })
    expect(buildPatchInput({ ...formFromConnection(original), useSsl: false }, original)).toEqual({ useSsl: false })
  })

  it('detects the TRUSTED_STORAGE_HOSTS rejection', () => {
    expect(isUntrustedEndpointError(new ApiError('endpoint resolves to a private/loopback/link-local address; add its host or CIDR to TRUSTED_STORAGE_HOSTS to allow it', 400))).toBe(true)
    expect(isUntrustedEndpointError(new ApiError('Invalid bucket', 400))).toBe(false)
  })

  it('includes zod issues in the save error', () => {
    const err = new ApiError('Validation error', 400, { error: 'Validation error', issues: [{ path: ['name'], message: 'Too long' }] })
    expect(saveErrorMessage(err)).toBe('Validation error: name: Too long')
  })

  it('classifies test results, with forbidden as a warning', () => {
    expect(testOutcome(result({}))).toBe('success')
    expect(testOutcome(result({ auth: 'forbidden', bucket: 'unchecked', canList: false }))).toBe('warning')
    expect(testOutcome(result({ reachable: false, auth: 'failed', bucket: 'unchecked' }))).toBe('error')
    expect(testOutcome(result({ bucket: 'not-found' }))).toBe('error')
    expect(testOutcome(result({ auth: 'failed', bucket: 'unchecked' }))).toBe('error')
  })

  it('offers only clip/both stored connections in the clip picker', () => {
    const list = [
      conn({ id: 'default', isDefault: true }),
      conn({ id: 'a', role: 'clip' }),
      conn({ id: 'b', role: 'recording' }),
      conn({ id: 'c', role: 'both' }),
    ]
    expect(clipPickerConnections(list).map((c) => c.id)).toEqual(['a', 'c'])
  })
})
