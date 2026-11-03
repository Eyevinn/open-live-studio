import { useCallback, useEffect, useState } from 'react'
import { useIntercomConnectionStore } from '@/store/intercomConnection.store'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { inputCls, labelCls } from '@/components/ui/SrtDirectionFields'
import {
  ApiError,
  intercomConnectionApi,
  type ApiIntercomConnectionStatus,
  type IntercomConnectionTestResult,
} from '@/lib/api'
import {
  INTERCOM_NOT_CONFIGURED_TEXT,
  INTERCOM_TEST_STATUS_LABELS,
  buildSaveInput,
  buildTestInput,
  formFromStatus,
  intercomErrorMessage,
  intercomTestOutcome,
  isUntrustedHostError,
  managerOrigin,
  modeForUrl,
  rememberMode,
  sourceText,
  validateIntercomConnectionForm,
  whipKeyNote,
  type IntercomConnectionForm,
  type KnownModes,
} from '@/lib/intercomConnection'

function Fact({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-[--color-text-muted]">{label}</span>
      <span data-testid={testId} className="text-[--color-text-primary] font-mono truncate">{value}</span>
    </div>
  )
}

function StatusView({ status }: { status: ApiIntercomConnectionStatus }) {
  const headline =
    status.source === 'none' ? INTERCOM_NOT_CONFIGURED_TEXT : status.configured ? 'Configured' : 'Not usable'
  const tone =
    status.source === 'none' ? 'text-[--color-text-muted]' : status.configured ? 'text-emerald-400' : 'text-amber-300'
  return (
    <div data-testid="intercom-status" className="flex flex-col gap-1.5 rounded border border-[--color-border] bg-[--color-surface-3] p-3">
      <div className="flex items-center gap-2">
        <span data-testid="intercom-status-headline" className={`text-sm font-medium ${tone}`}>{headline}</span>
        {status.mode && (
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted]">
            mode {status.mode}
          </span>
        )}
        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted]">
          source {status.source}
        </span>
      </div>
      {status.source !== 'none' && <p className="text-xs text-[--color-text-muted]">{sourceText(status)}</p>}
      {status.problem && <p data-testid="intercom-status-problem" className="text-xs text-amber-300">{status.problem}</p>}
      {status.url && <Fact label="Manager URL" value={status.url} />}
      {status.mode === 'direct' && (
        <>
          <Fact label="API key" value={status.tokenSet ? 'set' : 'not set'} testId="intercom-status-api-key" />
          <Fact label="WHIP key" value={status.whipKeySet ? 'set' : 'not set'} testId="intercom-status-whip-key" />
        </>
      )}
      {status.mode === 'osc' && <Fact label="PAT source" value={status.patSource ?? 'not set'} />}
      {status.updatedAt && <Fact label="Updated" value={new Date(status.updatedAt).toLocaleString()} />}
    </div>
  )
}

function TestResultView({ result }: { result: IntercomConnectionTestResult }) {
  const outcome = intercomTestOutcome(result)
  const tone =
    outcome === 'success' ? 'border-emerald-700 text-emerald-300'
      : outcome === 'warning' ? 'border-amber-600 text-amber-300'
        : 'border-red-700 text-red-300'
  const whip = whipKeyNote(result)
  return (
    <div data-testid="intercom-test-result" className={`flex flex-col gap-1.5 rounded border p-3 ${tone}`}>
      <p data-testid="intercom-test-status" className="text-sm font-medium">
        {INTERCOM_TEST_STATUS_LABELS[result.status]}
        {result.httpStatus !== undefined && result.status !== 'ok' ? ` (HTTP ${result.httpStatus})` : ''}
      </p>
      <p className="text-xs">{result.message}</p>
      {result.mode && <Fact label="Mode" value={result.mode} testId="intercom-test-mode" />}
      {result.patSource && <Fact label="PAT source" value={result.patSource} testId="intercom-test-pat-source" />}
      {result.url && <Fact label="Manager URL" value={result.url} />}
      <Fact label="Tested" value={result.source === 'unsaved' ? 'unsaved values' : `${result.source} connection`} />
      {whip && <p data-testid="intercom-test-whip" className="text-xs text-[--color-text-muted]">{whip}</p>}
    </div>
  )
}

/**
 * Setup → Intercom (studio#254, OL-48). Shows the status of the Open Intercom
 * manager connection in effect, tests unsaved values, saves and clears it.
 *
 * The auth mode is never inferred here: until a status read or Test returned a
 * `mode` for the URL in the form, only the URL field is shown. The API key
 * (and, under Advanced, the WHIP key) appear only in `direct` mode. Both keys
 * are write-only: they live in this component's state only while typed, are
 * sent only when non-empty, and are cleared on save. Errors are shown inline
 * once (the API calls are `quiet`).
 */
export function IntercomPanel() {
  const { status, isLoading, loadError, fetchStatus, save, clear } = useIntercomConnectionStore()

  const [form, setForm] = useState<IntercomConnectionForm>(() => formFromStatus(status))
  const [knownModes, setKnownModes] = useState<KnownModes>(() => rememberMode({}, status?.url, status?.mode))

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [untrusted, setUntrusted] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<IntercomConnectionTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)

  /** Seeds the form (URL only, never keys) and the known mode from a status view. */
  const seedFrom = useCallback((s: ApiIntercomConnectionStatus | null) => {
    setForm(formFromStatus(s))
    setKnownModes((k) => rememberMode(k, s?.url, s?.mode))
  }, [])

  const loadStatus = useCallback(async () => {
    await fetchStatus()
    seedFrom(useIntercomConnectionStore.getState().status)
  }, [fetchStatus, seedFrom])

  useEffect(() => { void loadStatus() }, [loadStatus])

  const mode = modeForUrl(knownModes, form.url)
  // The stored keys are only kept for the same manager origin (backend rule).
  const sameStoredOrigin =
    status?.source === 'stored' && status.mode === 'direct' && managerOrigin(form.url) === managerOrigin(status.url)
  const apiKeyStored = sameStoredOrigin && status?.tokenSet === true
  const whipKeyStored = sameStoredOrigin && status?.whipKeySet === true

  function patchForm(next: Partial<IntercomConnectionForm>) {
    setForm((f) => ({ ...f, ...next }))
  }

  async function handleTest() {
    if (testing) return
    const body = buildTestInput(form, mode, status)
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    setUntrusted(false)
    try {
      const result = await intercomConnectionApi.test(body)
      setKnownModes((k) => rememberMode(rememberMode(k, body.url, result.mode), result.url, result.mode))
      setTestResult(result)
    } catch (err) {
      setTestError(intercomErrorMessage(err, 'Test failed'))
      setUntrusted(isUntrustedHostError(err))
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    if (saving) return
    const invalid = validateIntercomConnectionForm(form)
    if (invalid) { setSaveError(invalid); return }
    setSaving(true)
    setSaveError(null)
    setUntrusted(false)
    const body = buildSaveInput(form, mode)
    try {
      const saved = await save(body)
      // Drops the typed keys; the status now says "set".
      seedFrom(saved)
      setTestResult(null)
      setTestError(null)
    } catch (err) {
      setSaveError(intercomErrorMessage(err, 'Failed to save the intercom connection'))
      setUntrusted(isUntrustedHostError(err))
      // A URL-only save refused for a manager that turns out to need an API
      // key: ask the backend for the mode (nothing is persisted by a test) so
      // the key field appears. Studio still does not infer it.
      if (mode === null && err instanceof ApiError && err.status === 400 && !isUntrustedHostError(err)) {
        try {
          const probe = await intercomConnectionApi.test({ url: body.url })
          setKnownModes((k) => rememberMode(rememberMode(k, body.url, probe.mode), probe.url, probe.mode))
        } catch {
          // The save error above already explains the problem.
        }
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    if (clearing) return
    setClearing(true)
    setClearError(null)
    try {
      await clear()
      seedFrom(useIntercomConnectionStore.getState().status)
      setTestResult(null)
      setTestError(null)
      setSaveError(null)
      setConfirmClear(false)
    } catch (err) {
      setClearError(intercomErrorMessage(err, 'Failed to remove the intercom connection'))
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[--color-text-muted]">
          Open Intercom manager used for guest talkback. Guests who joined before a change get talkback when they rejoin.
        </span>
        {isLoading && <span className="text-xs text-[--color-accent]">Refreshing…</span>}
      </div>

      {loadError && (
        <div className="flex items-center justify-between rounded border border-red-800 px-3 py-2 text-xs text-red-300">
          <span data-testid="intercom-load-error">Could not load the intercom connection: {loadError}</span>
          <Button size="sm" variant="ghost" onClick={() => void loadStatus()}>Retry</Button>
        </div>
      )}

      {status && <StatusView status={status} />}

      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="intercom-url" className={labelCls}>Manager URL</label>
          <input
            id="intercom-url"
            type="text"
            value={form.url}
            onChange={(e) => patchForm({ url: e.target.value })}
            placeholder="https://<tenant>.eyevinn-intercom-manager.auto.prod.osaas.io"
            autoComplete="off"
            className={inputCls}
          />
          <p data-testid="intercom-mode" className="text-xs text-[--color-text-muted] mt-1">
            {mode
              ? `Mode: ${mode} (reported by open-live)`
              : 'Mode: not known yet. Press Test connection to detect it.'}
          </p>
        </div>

        {mode === 'direct' && (
          <>
            <div>
              <label htmlFor="intercom-api-key" className={labelCls}>Manager API key</label>
              <input
                id="intercom-api-key"
                type="password"
                value={form.apiKey}
                onChange={(e) => patchForm({ apiKey: e.target.value })}
                autoComplete="new-password"
                placeholder={apiKeyStored ? 'API key set (leave empty to keep it)' : ''}
                className={inputCls}
              />
              {apiKeyStored && (
                <p className="text-xs text-[--color-text-muted] mt-1">API key set. Type a new one only to replace it.</p>
              )}
            </div>
            <details className="rounded border border-[--color-border] px-3 py-2">
              <summary className="text-xs text-[--color-text-muted] cursor-pointer">Advanced</summary>
              <div className="flex flex-col gap-2 mt-2">
                <label htmlFor="intercom-whip-key" className={labelCls}>WHIP key</label>
                <input
                  id="intercom-whip-key"
                  type="password"
                  value={form.whipKey}
                  onChange={(e) => patchForm({ whipKey: e.target.value, clearWhipKey: false })}
                  autoComplete="new-password"
                  placeholder={whipKeyStored ? 'WHIP key set (leave empty to keep it)' : 'optional'}
                  className={inputCls}
                />
                {whipKeyStored && (
                  <label className="flex items-center gap-2 text-xs text-[--color-text-primary]">
                    <input
                      type="checkbox"
                      checked={form.clearWhipKey}
                      disabled={form.whipKey !== ''}
                      onChange={(e) => patchForm({ clearWhipKey: e.target.checked })}
                    />
                    Remove the stored WHIP key on save
                  </label>
                )}
              </div>
            </details>
          </>
        )}

        <div className="flex items-center gap-2">
          <Button variant="ghost" className="text-white hover:text-orange-500" onClick={() => void handleTest()} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <Button variant="active" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {status?.source === 'stored' && (
            <Button
              variant="ghost"
              className="text-white hover:text-red-400 ml-auto"
              onClick={() => { setClearError(null); setConfirmClear(true) }}
            >
              Remove
            </Button>
          )}
        </div>

        {saveError && <p data-testid="intercom-save-error" className="text-xs text-red-400">{saveError}</p>}
        {testError && <p data-testid="intercom-test-error" className="text-xs text-red-400">{testError}</p>}
        {untrusted && (
          <p className="text-xs text-[--color-text-muted]">
            Studio cannot change this. The server administrator must add the manager host to TRUSTED_INTERCOM_HOSTS.
          </p>
        )}
        {testResult && <TestResultView result={testResult} />}
      </div>

      {confirmClear && (
        <Modal open title="Remove Intercom Connection" onClose={() => setConfirmClear(false)} className="max-w-sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[--color-text-primary]">
              Remove the stored intercom connection? The environment configuration applies again if there is one;
              otherwise guest talkback is off.
            </p>
            {clearError && <p className="text-xs text-red-400">{clearError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => void handleClear()} disabled={clearing}>Remove</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
