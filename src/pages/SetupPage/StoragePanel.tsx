import { useEffect, useState } from 'react'
import { useStorageStore } from '@/store/storage.store'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { inputCls, labelCls } from '@/components/ui/SrtDirectionFields'
import {
  storageConnectionsApi,
  type ApiStorageConnection,
  type StorageConnectionRole,
  type StorageConnectionTestResult,
} from '@/lib/api'
import {
  STORAGE_ROLE_LABELS,
  buildCreateInput,
  buildPatchInput,
  emptyStorageConnectionForm,
  formFromConnection,
  isUntrustedEndpointError,
  saveErrorMessage,
  testOutcome,
  validateStorageConnectionForm,
  type StorageConnectionForm,
} from '@/lib/storageConnection'

const ROLES: StorageConnectionRole[] = ['clip', 'recording', 'both']

function timeSince(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

/** Add / Edit dialog state. `original` is set when editing. */
interface FormState {
  original: ApiStorageConnection | null
  form: StorageConnectionForm
}

interface TestState {
  connection: ApiStorageConnection
  bucket: string
  running: boolean
  result: StorageConnectionTestResult | null
  error: string | null
}

function Fact({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[--color-text-muted]">{label}</span>
      <span className={ok ? 'text-emerald-400' : 'text-red-400'}>{value}</span>
    </div>
  )
}

function TestResultView({ result }: { result: StorageConnectionTestResult }) {
  const outcome = testOutcome(result)
  const tone =
    outcome === 'success' ? 'border-emerald-700 text-emerald-300'
      : outcome === 'warning' ? 'border-amber-600 text-amber-300'
        : 'border-red-700 text-red-300'
  return (
    <div className={`flex flex-col gap-2 rounded border p-3 ${tone}`}>
      <p className="text-sm">{result.message}</p>
      <Fact label="Reachable" value={result.reachable ? 'yes' : 'no'} ok={result.reachable} />
      <Fact
        label="Credentials"
        value={result.auth === 'ok' ? 'ok' : result.auth === 'forbidden' ? 'valid, no list permission' : 'failed'}
        ok={result.auth === 'ok'}
      />
      <Fact
        label="Bucket"
        value={result.bucket === 'found' ? 'found' : result.bucket === 'not-found' ? 'not found' : 'not checked'}
        ok={result.bucket === 'found'}
      />
      {outcome === 'warning' && (
        <p className="text-xs text-amber-300">
          Warning: this key cannot list the bucket, so browsing objects from Studio will not work.
        </p>
      )}
      {result.note && <p className="text-xs text-[--color-text-muted]">{result.note}</p>}
      <p className="text-xs text-[--color-text-muted]">Checked from open-live</p>
    </div>
  )
}

/**
 * Setup → Storage (studio#217, OL-21b.1). Lists, creates, edits, tests and
 * deletes storage connections. The secret key is write-only: it lives only in
 * this dialog's state while typed, is sent only when non-empty, and is cleared
 * as soon as the dialog closes or saves. Backend errors are shown inline once
 * (the API calls are `quiet`, so no toast duplicates them).
 */
export function StoragePanel() {
  const { connections, isLoading, loadError, lastFetchedAt, fetchAll, addConnection, updateConnection, removeConnection } =
    useStorageStore()

  useEffect(() => { void fetchAll() }, [fetchAll])

  const [formState, setFormState] = useState<FormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [untrusted, setUntrusted] = useState(false)
  const [saving, setSaving] = useState(false)

  const [testState, setTestState] = useState<TestState | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<ApiStorageConnection | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function openAdd() {
    setFormState({ original: null, form: { ...emptyStorageConnectionForm } })
    setFormError(null)
    setUntrusted(false)
  }

  function openEdit(c: ApiStorageConnection) {
    setFormState({ original: c, form: formFromConnection(c) })
    setFormError(null)
    setUntrusted(false)
  }

  function closeForm() {
    // Dropping the form state also drops any typed secret.
    setFormState(null)
    setFormError(null)
    setUntrusted(false)
    setSaving(false)
  }

  function patchForm(next: Partial<StorageConnectionForm>) {
    setFormState((s) => (s ? { ...s, form: { ...s.form, ...next } } : s))
  }

  async function handleSave() {
    if (!formState || saving) return
    const { original, form } = formState
    const invalid = validateStorageConnectionForm(form, original ?? undefined)
    if (invalid) { setFormError(invalid); return }
    setSaving(true)
    setFormError(null)
    setUntrusted(false)
    try {
      if (original) {
        const patch = buildPatchInput(form, original)
        if (Object.keys(patch).length > 0) await updateConnection(original.id, patch)
      } else {
        await addConnection(buildCreateInput(form))
      }
      closeForm()
    } catch (err) {
      // Keep the dialog open with the entered values; show the backend message once.
      setFormError(saveErrorMessage(err))
      setUntrusted(isUntrustedEndpointError(err))
      setSaving(false)
    }
  }

  function openTest(c: ApiStorageConnection) {
    setTestState({ connection: c, bucket: c.defaultBucket ?? '', running: false, result: null, error: null })
  }

  async function runTest() {
    if (!testState || testState.running) return
    const { connection, bucket } = testState
    setTestState({ ...testState, running: true, result: null, error: null })
    try {
      const result = await storageConnectionsApi.test(connection.id, bucket.trim() || undefined)
      setTestState((s) => (s && s.connection.id === connection.id ? { ...s, running: false, result } : s))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test failed'
      setTestState((s) => (s && s.connection.id === connection.id ? { ...s, running: false, error: message } : s))
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await removeConnection(deleteTarget.id)
      setDeleteTarget(null)
    } catch (err) {
      // 409 carries the backend's reference counts in its message.
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete the storage connection')
    } finally {
      setDeleting(false)
    }
  }

  const editing = formState?.original ?? null
  const form = formState?.form

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[--color-text-muted] font-mono">
            {connections.length} connections · refreshed {timeSince(lastFetchedAt)}
          </span>
          {isLoading && <span className="text-xs text-[--color-accent]">Refreshing…</span>}
        </div>
        <Button size="sm" variant="active" onClick={openAdd}>+ New Connection</Button>
      </div>

      {loadError && (
        <div className="flex items-center justify-between rounded border border-red-800 px-3 py-2 text-xs text-red-300">
          <span>Could not load storage connections: {loadError}</span>
          <Button size="sm" variant="ghost" onClick={() => void fetchAll()}>Retry</Button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {connections.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded bg-[--color-surface-3] border border-[--color-border]"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[--color-text-primary] truncate">{c.name}</span>
                {c.isDefault && (
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted] uppercase">
                    Instance default · read-only
                  </span>
                )}
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted]">
                  {STORAGE_ROLE_LABELS[c.role]}
                </span>
              </div>
              <span className="text-xs text-[--color-text-muted] font-mono truncate block">
                {c.endpoint} · bucket {c.defaultBucket ?? '(none)'} · {c.secretKeySet ? 'Secret key set' : 'No secret key'}
              </span>
            </div>
            <Button size="sm" variant="ghost" className="text-white hover:text-orange-500" onClick={() => openTest(c)}>
              Test
            </Button>
            {!c.isDefault && (
              <>
                <Button size="sm" variant="ghost" className="text-white hover:text-orange-500" onClick={() => openEdit(c)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white hover:text-red-400"
                  onClick={() => { setDeleteError(null); setDeleteTarget(c) }}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        ))}
        {connections.length === 0 && !isLoading && !loadError && (
          <p className="text-sm text-[--color-text-muted] py-4 text-center">
            No storage connections. Add one to play clips from your own S3-compatible bucket.
          </p>
        )}
      </div>

      {/* Add / Edit */}
      {formState && form && (
        <Modal
          open
          title={editing ? 'Edit Storage Connection' : 'New Storage Connection'}
          onClose={closeForm}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeForm}>Cancel</Button>
              <Button variant="active" onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <div>
              <label className={labelCls}>Name</label>
              <input type="text" value={form.name} onChange={(e) => patchForm({ name: e.target.value })} placeholder="Customer clips" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Endpoint</label>
              <input type="text" value={form.endpoint} onChange={(e) => patchForm({ endpoint: e.target.value })} placeholder="https://s3.eu-north-1.amazonaws.com" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Region</label>
                <input type="text" value={form.region} onChange={(e) => patchForm({ region: e.target.value })} placeholder="us-east-1" className={inputCls} />
              </div>
              <label className="flex items-center gap-2 text-sm text-[--color-text-primary] mt-5">
                <input type="checkbox" checked={form.useSsl} onChange={(e) => patchForm({ useSsl: e.target.checked })} />
                Use SSL (https)
              </label>
            </div>
            <div>
              <label className={labelCls}>Access Key</label>
              <input type="text" value={form.accessKey} onChange={(e) => patchForm({ accessKey: e.target.value })} autoComplete="off" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Secret Key</label>
              <input
                type="password"
                value={form.secretKey}
                onChange={(e) => patchForm({ secretKey: e.target.value })}
                autoComplete="new-password"
                placeholder={editing?.secretKeySet ? 'Secret key set (leave empty to keep it)' : ''}
                className={inputCls}
              />
              {editing?.secretKeySet && (
                <p className="text-xs text-[--color-text-muted] mt-1">Secret key set. Type a new one only to replace it.</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Default Bucket</label>
              <input type="text" value={form.defaultBucket} onChange={(e) => patchForm({ defaultBucket: e.target.value })} placeholder="my-clips" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Role</label>
              <div className="grid grid-cols-3 gap-2">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => patchForm({ role: r })}
                    className={`py-2 rounded text-sm border transition-colors ${
                      form.role === r
                        ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                        : 'bg-[var(--color-surface-2)] border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-orange-500'
                    }`}
                  >
                    {STORAGE_ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
            {untrusted && (
              <p className="text-xs text-[--color-text-muted]">
                Studio cannot change this. The server administrator must add the endpoint host to TRUSTED_STORAGE_HOSTS.
              </p>
            )}
          </div>
        </Modal>
      )}

      {/* Test */}
      {testState && (
        <Modal open title={`Test ${testState.connection.name}`} onClose={() => setTestState(null)}>
          <div className="flex flex-col gap-3">
            <div>
              <label className={labelCls}>Bucket</label>
              <input
                type="text"
                value={testState.bucket}
                onChange={(e) => setTestState({ ...testState, bucket: e.target.value })}
                placeholder={testState.connection.defaultBucket ?? 'bucket to test'}
                className={inputCls}
              />
            </div>
            <div className="flex justify-end">
              <Button variant="active" onClick={() => void runTest()} disabled={testState.running}>
                {testState.running ? 'Testing…' : 'Test connection'}
              </Button>
            </div>
            {testState.error && <p className="text-xs text-red-400">{testState.error}</p>}
            {testState.result && <TestResultView result={testState.result} />}
          </div>
        </Modal>
      )}

      {/* Delete */}
      {deleteTarget && (
        <Modal open title="Delete Storage Connection" onClose={() => { setDeleteTarget(null); setDeleteError(null) }} className="max-w-sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[--color-text-primary]">
              Delete <span className="font-semibold">{deleteTarget.name}</span>? This cannot be undone.
            </p>
            {deleteError && <p className="text-xs text-red-400">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setDeleteTarget(null); setDeleteError(null) }}>Cancel</Button>
              <Button variant="danger" onClick={() => void handleDelete()} disabled={deleting}>Delete</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
