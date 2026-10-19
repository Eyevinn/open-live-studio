import { afterEach, describe, expect, it, vi } from 'vitest'

// api.ts reads `window._env_` and the SAT auth on import; stub both so the real
// ApiError class and API client can be loaded in the node test environment.
vi.mock('./base.js', () => ({ BASE: 'http://test' }))
vi.mock('./sat.js', () => ({ authenticateWithOpenLive: vi.fn(), getApiToken: vi.fn().mockResolvedValue(null) }))

import { ApiError, storageConnectionsApi, type ApiStorageConnection, type StorageListPage } from './api'
import {
  BROWSE_PAGE_SIZE,
  breadcrumb,
  browseConnectionId,
  browseErrorMessage,
  browseReducer,
  folderLabel,
  formatLastModified,
  formatSize,
  initialBrowseBucket,
  initialBrowseState,
  visibleObjects,
} from './bucketBrowser'
import { validateBucketName } from './clipRef'

function conn(overrides: Partial<ApiStorageConnection> = {}): ApiStorageConnection {
  return {
    id: 'stconn-1', name: 'C', endpoint: 's3.example.com', region: '', useSsl: true,
    role: 'clip', accessKey: 'AK', secretKeySet: true, createdAt: null, updatedAt: null, ...overrides,
  }
}

function page(overrides: Partial<StorageListPage> = {}): StorageListPage {
  return { bucket: 'clips', prefix: '', folders: [], objects: [], ...overrides }
}

const obj = (key: string) => ({ key, name: key.split('/').pop() ?? key, size: 10, lastModified: '2026-10-01T10:00:00.000Z' })

describe('bucket browser: connection and bucket', () => {
  it('maps the picker default to the "default" connection', () => {
    expect(browseConnectionId('')).toBe('default')
    expect(browseConnectionId('stconn-1')).toBe('stconn-1')
  })

  it('lists the defaultBucket without asking, and asks when there is none', () => {
    expect(initialBrowseBucket(conn({ defaultBucket: 'clips' }))).toBe('clips')
    expect(initialBrowseBucket(conn())).toBeNull()
    expect(initialBrowseBucket(conn({ id: 'default', isDefault: true }))).toBeNull()
    expect(initialBrowseBucket(undefined)).toBeNull()
  })

  it('validates the prompted bucket name', () => {
    expect(validateBucketName('')).toBe('Bucket is required')
    expect(validateBucketName('My_Bucket')).toMatch(/Invalid bucket/)
    expect(validateBucketName(' clips ')).toBeNull()
  })
})

describe('bucket browser: display helpers', () => {
  it('builds a breadcrumb rooted at the bucket', () => {
    expect(breadcrumb('clips', '')).toEqual([{ label: 'clips', prefix: '' }])
    expect(breadcrumb('clips', 'a/b/')).toEqual([
      { label: 'clips', prefix: '' },
      { label: 'a', prefix: 'a/' },
      { label: 'b', prefix: 'a/b/' },
    ])
  })

  it('labels folders relative to the current prefix', () => {
    expect(folderLabel({ prefix: 'a/b/' }, 'a/')).toBe('b')
    expect(folderLabel({ prefix: 'top/' }, '')).toBe('top')
  })

  it('hides the folder marker object of the current prefix', () => {
    const objects = [obj('a/'), obj('a/clip.mp4'), obj('a/sub/')]
    expect(visibleObjects(objects, 'a/').map((o) => o.key)).toEqual(['a/clip.mp4'])
  })

  it('formats sizes and timestamps', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(5 * 1024 * 1024 * 1024)).toBe('5.0 GB')
    expect(formatLastModified('')).toBe('—')
    expect(formatLastModified('not a date')).toBe('—')
    expect(formatLastModified('2026-10-01T10:00:00.000Z')).not.toBe('—')
  })
})

describe('bucket browser: error messages', () => {
  it('shows the backend message for 403, 404 and 502', () => {
    expect(browseErrorMessage(new ApiError('The storage key lacks list permission (AccessDenied)', 403)))
      .toBe('The storage key lacks list permission (AccessDenied)')
    expect(browseErrorMessage(new ApiError('Bucket not found', 404))).toBe('Bucket not found')
    expect(browseErrorMessage(new ApiError('Object store unreachable', 502))).toBe('Object store unreachable')
  })

  it('falls back to a status-specific line when the body had no message', () => {
    expect(browseErrorMessage(new ApiError('', 403))).toMatch(/list permission/)
    expect(browseErrorMessage(new ApiError('', 502))).toBe('Object store unreachable')
    expect(browseErrorMessage(new ApiError('', 500))).toBe('Listing failed (HTTP 500)')
    expect(browseErrorMessage('boom')).toBe('Could not list objects')
  })
})

describe('bucket browser: listing state', () => {
  it('replaces rows when a level is opened', () => {
    let s = browseReducer(initialBrowseState, { type: 'open', prefix: '' })
    s = browseReducer(s, { type: 'loaded', page: page({ folders: [{ prefix: 'a/' }], objects: [obj('x.mp4')], cursor: 'c1' }) })
    expect(s.status).toBe('loaded')
    expect(s.cursor).toBe('c1')

    s = browseReducer(s, { type: 'open', prefix: 'a/' })
    expect(s).toMatchObject({ prefix: 'a/', folders: [], objects: [], status: 'loading' })
    expect(s.cursor).toBeUndefined()
  })

  it('appends pages via Load more until the cursor is absent', () => {
    let s = browseReducer(initialBrowseState, { type: 'open', prefix: '' })
    s = browseReducer(s, { type: 'loaded', page: page({ objects: [obj('1.mp4')], cursor: 'c1' }) })
    s = browseReducer(s, { type: 'more' })
    expect(s.objects).toHaveLength(1)
    s = browseReducer(s, { type: 'loaded', page: page({ objects: [obj('2.mp4')] }) })
    expect(s.objects.map((o) => o.key)).toEqual(['1.mp4', '2.mp4'])
    expect(s.cursor).toBeUndefined()
  })

  it('keeps rows and cursor when Load more fails so Retry can repeat it', () => {
    let s = browseReducer(initialBrowseState, { type: 'open', prefix: '' })
    s = browseReducer(s, { type: 'loaded', page: page({ objects: [obj('1.mp4')], cursor: 'c1' }) })
    s = browseReducer(s, { type: 'more' })
    s = browseReducer(s, { type: 'failed', error: 'Object store unreachable' })
    expect(s).toMatchObject({ status: 'error', appending: true, cursor: 'c1', error: 'Object store unreachable' })
    expect(s.objects).toHaveLength(1)
  })

  it('reports an empty level as loaded with no rows', () => {
    let s = browseReducer(initialBrowseState, { type: 'open', prefix: 'empty/' })
    s = browseReducer(s, { type: 'loaded', page: page({ prefix: 'empty/' }) })
    expect(s).toMatchObject({ status: 'loaded', folders: [], objects: [] })
  })
})

describe('storageConnectionsApi.listObjects', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends a read-only GET with prefix, cursor, bucket and maxKeys', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(page()), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await storageConnectionsApi.listObjects('default', { prefix: 'a b/', cursor: 'c+1', bucket: 'clips', maxKeys: BROWSE_PAGE_SIZE })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method ?? 'GET').toBe('GET')
    const u = new URL(url)
    expect(u.pathname).toBe('/api/v1/storage-connections/default/objects')
    expect(Object.fromEntries(u.searchParams)).toEqual({ prefix: 'a b/', cursor: 'c+1', bucket: 'clips', maxKeys: '200' })
  })

  it('throws an ApiError carrying the backend message and status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Bucket not found', statusCode: 404 }), { status: 404 }),
    ))
    await expect(storageConnectionsApi.listObjects('stconn-1', { bucket: 'nope' }))
      .rejects.toMatchObject({ name: 'ApiError', status: 404, message: 'Bucket not found' })
  })
})
