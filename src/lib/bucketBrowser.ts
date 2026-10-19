// ─── Read-only bucket browser (studio#218, OL-21b.2) ─────────────────────────
// Pure state and formatting helpers behind BucketBrowserModal, kept out of the
// component so paging, breadcrumb and error mapping are unit-testable. The
// browser only ever calls `GET /api/v1/storage-connections/:id/objects`.
import {
  ApiError,
  DEFAULT_STORAGE_CONNECTION_ID,
  type ApiStorageConnection,
  type StorageFolder,
  type StorageListPage,
  type StorageObject,
} from '@/lib/api'

/** Page size per request (studio#216 item 9; the backend clamps it further). */
export const BROWSE_PAGE_SIZE = 200

/** Connection id the browser lists for a picker value ('' is the instance default). */
export function browseConnectionId(pickerValue: string): string {
  return pickerValue.trim() || DEFAULT_STORAGE_CONNECTION_ID
}

/**
 * The bucket to list without asking: the connection's `defaultBucket`. Returns
 * null when the operator must type one first (no `defaultBucket`, which is
 * always the case for the synthetic `default` entry, or an unknown connection).
 */
export function initialBrowseBucket(connection: ApiStorageConnection | undefined): string | null {
  return connection?.defaultBucket?.trim() || null
}

export interface BreadcrumbItem {
  label: string
  prefix: string
}

/** Breadcrumb for `prefix`: the bucket as root, then one entry per folder level. */
export function breadcrumb(bucket: string, prefix: string): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [{ label: bucket, prefix: '' }]
  let acc = ''
  for (const segment of prefix.split('/').filter(Boolean)) {
    acc += `${segment}/`
    items.push({ label: segment, prefix: acc })
  }
  return items
}

/** Display name of a folder relative to the current prefix, without the trailing `/`. */
export function folderLabel(folder: StorageFolder, currentPrefix: string): string {
  const rel = folder.prefix.startsWith(currentPrefix) ? folder.prefix.slice(currentPrefix.length) : folder.prefix
  const trimmed = rel.endsWith('/') ? rel.slice(0, -1) : rel
  return trimmed || folder.prefix
}

/**
 * Objects worth showing: drops the zero-byte "folder marker" some stores return
 * for the current prefix itself (key equal to the prefix, or ending in `/`),
 * which cannot be played as a clip.
 */
export function visibleObjects(objects: StorageObject[], currentPrefix: string): StorageObject[] {
  return objects.filter((o) => o.key !== currentPrefix && !o.key.endsWith('/'))
}

/** Human-readable size (binary units, one decimal above bytes). */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return i === 0 ? `${value} B` : `${value.toFixed(1)} ${units[i]}`
}

/** Locale date/time for an object's `lastModified`, or '—' when missing/invalid. */
export function formatLastModified(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/**
 * Readable message for a failed listing. The backend messages for 403 (no list
 * permission), 404 (bucket or connection not found), 400 (no bucket) and 502
 * (store unreachable) are shown as sent; anything else gets a generic line.
 */
export function browseErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.message) return err.message
    if (err.status === 403) return 'The storage key lacks list permission'
    if (err.status === 404) return 'Bucket not found'
    if (err.status === 502) return 'Object store unreachable'
    return `Listing failed (HTTP ${err.status})`
  }
  return err instanceof Error && err.message ? err.message : 'Could not list objects'
}

// ─── Listing state ───────────────────────────────────────────────────────────

export interface BrowseState {
  /** Prefix currently shown (or being loaded). '' is the bucket root. */
  prefix: string
  folders: StorageFolder[]
  objects: StorageObject[]
  /** Cursor for the next page; undefined on the last page. */
  cursor?: string
  status: 'idle' | 'loading' | 'loaded' | 'error'
  /** True while/after a failed request was a "Load more" (keeps the rows shown). */
  appending: boolean
  error: string | null
}

export const initialBrowseState: BrowseState = {
  prefix: '',
  folders: [],
  objects: [],
  status: 'idle',
  appending: false,
  error: null,
}

export type BrowseAction =
  /** New level (folder navigation, bucket change, retry of a first page): rows are cleared. */
  | { type: 'open'; prefix: string }
  /** Next page of the current level via `cursor`: rows are kept. */
  | { type: 'more' }
  | { type: 'loaded'; page: StorageListPage }
  | { type: 'failed'; error: string }

export function browseReducer(state: BrowseState, action: BrowseAction): BrowseState {
  switch (action.type) {
    case 'open':
      return { ...initialBrowseState, prefix: action.prefix, status: 'loading' }
    case 'more':
      return { ...state, status: 'loading', appending: true, error: null }
    case 'loaded': {
      const page = action.page
      return {
        ...state,
        folders: state.appending ? [...state.folders, ...page.folders] : page.folders,
        objects: state.appending ? [...state.objects, ...page.objects] : page.objects,
        cursor: page.cursor || undefined,
        status: 'loaded',
        appending: false,
        error: null,
      }
    }
    case 'failed':
      return { ...state, status: 'error', error: action.error }
  }
}
