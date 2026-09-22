/**
 * Secure interactive-login popup for authenticated HTML sources.
 *
 * ── What this is (and is NOT) ────────────────────────────────────────────────
 * Issue #129 originally sketched "Design A": open a popup, let the operator log
 * in, then harvest the popup's *live session cookies* and forward them to the
 * server-side browser via `POST /api/sources/:id/session`. The accepted spec
 * (`open-live` `docs/specs/authenticated-html-sources.md`, ADR-003) **rejected
 * Design A outright**: there is no `/session` endpoint, and `HttpOnly`/`Secure`
 * cookies are by design NOT readable from a popup's JS, so they can never be
 * harvested via `postMessage` anyway. The shipping mechanism is a scoped,
 * rotatable **header credential** (Design B) applied through the real
 * `PATCH /api/v1/sources/:id` + `POST .../auth/rotate` endpoints.
 *
 * This helper therefore does one narrow, safe thing: it opens the provider's
 * login page in a popup and waits for that page (or a small operator-controlled
 * relay it hosts) to VOLUNTARILY post back a **token string** — e.g. a bearer
 * token or API key the provider hands the logged-in user. That token is then
 * stored, encrypted at rest, as the source's header credential. No cookie is
 * read, no live human session is forwarded into the shared server-side browser.
 *
 * ── Security invariants (mandatory, per the spec's ADR-003 review) ───────────
 *  1. `event.origin` is validated against an explicit allowlist. `*` is NEVER
 *     accepted, neither as an allowed origin nor as a `postMessage` target.
 *  2. The captured token is NEVER written to the DOM, the console, logs, or any
 *     analytics sink. It is handed straight to the caller and otherwise dropped.
 *  3. The message shape is validated from `unknown` with explicit narrowing —
 *     no `any`, no trusting `event.data` blindly.
 *  4. The listener is single-shot and torn down on resolve/reject/timeout so a
 *     hostile later message cannot smuggle a value in.
 */

/** Discriminator every trusted login/relay page must set on its `postMessage`. */
const MESSAGE_TYPE = 'open-live:html-auth-token'

/** How long to wait for the login flow before giving up (ms). */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export interface HtmlAuthPopupOptions {
  /** The provider login URL to open (already SSRF-validated http/https by the caller). */
  loginUrl: string
  /**
   * Exact origins permitted to post the token back (scheme + host + port), e.g.
   * `['https://dashboard.example.com']`. MUST be non-empty; `'*'` is rejected.
   */
  allowedOrigins: string[]
  /** Optional override of the wait timeout. */
  timeoutMs?: number
  /** Optional window name / features passthrough for `window.open`. */
  windowName?: string
}

export type HtmlAuthPopupResult =
  | { ok: true; token: string; origin: string }
  | { ok: false; reason: 'blocked' | 'closed' | 'timeout' | 'no-allowed-origins' }

/** A message we accept from the popup. Narrowed from `unknown` — never trusted raw. */
interface HtmlAuthTokenMessage {
  type: typeof MESSAGE_TYPE
  token: string
}

/**
 * Type guard for the trusted token message. Deliberately strict: the payload
 * must be an object with our exact `type` discriminator and a non-empty string
 * `token`. Anything else is ignored (a page on an allowed origin might post
 * unrelated messages, e.g. framework chatter).
 */
function isHtmlAuthTokenMessage(data: unknown): data is HtmlAuthTokenMessage {
  if (typeof data !== 'object' || data === null) return false
  const record = data as Record<string, unknown>
  return (
    record.type === MESSAGE_TYPE &&
    typeof record.token === 'string' &&
    record.token.length > 0
  )
}

/**
 * Normalizes an origin allowlist: trims, drops empties, and rejects any wildcard.
 * Returns `null` if the resulting list is empty or contains a wildcard, so the
 * caller fails closed rather than ever listening to `*`.
 */
function sanitizeAllowedOrigins(origins: string[]): string[] | null {
  const cleaned = origins.map((o) => o.trim()).filter((o) => o.length > 0)
  if (cleaned.length === 0) return null
  if (cleaned.some((o) => o === '*')) return null
  return cleaned
}

/**
 * Opens the interactive login popup and resolves with a captured token once a
 * page on an allowed origin posts it back. All security invariants above are
 * enforced here. The token is never logged or rendered by this module.
 */
export function openHtmlAuthPopup(options: HtmlAuthPopupOptions): Promise<HtmlAuthPopupResult> {
  const allowed = sanitizeAllowedOrigins(options.allowedOrigins)
  if (allowed === null) {
    return Promise.resolve({ ok: false, reason: 'no-allowed-origins' })
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const popup = window.open(
    options.loginUrl,
    options.windowName ?? 'open-live-html-auth',
    'popup=yes,width=520,height=680,noopener=no',
  )

  // Popup blocked by the browser.
  if (popup === null) {
    return Promise.resolve({ ok: false, reason: 'blocked' })
  }

  // Bind the now-proven-non-null values into the executor scope so the nested
  // closures below keep the narrowing (TS widens `let`/outer bindings otherwise).
  const openedPopup: Window = popup
  const allowedOrigins: string[] = allowed

  return new Promise<HtmlAuthPopupResult>((resolve) => {
    let settled = false

    function cleanup(): void {
      window.removeEventListener('message', onMessage)
      clearInterval(closedPoll)
      clearTimeout(timeoutId)
    }

    function settle(result: HtmlAuthPopupResult): void {
      if (settled) return
      settled = true
      cleanup()
      // Close the popup so the live login window does not linger. Guard against
      // a cross-origin `closed` access throwing.
      try {
        if (!openedPopup.closed) openedPopup.close()
      } catch {
        // Ignore — nothing sensitive here, and the token is already captured.
      }
      resolve(result)
    }

    function onMessage(event: MessageEvent<unknown>): void {
      // Invariant 1: strict origin check against the allowlist. Never `*`.
      if (!allowedOrigins.includes(event.origin)) return
      // Invariant 3: narrow from `unknown` before touching any field.
      if (!isHtmlAuthTokenMessage(event.data)) return
      // Invariant 2: the token is passed straight through — never logged/DOM'd.
      settle({ ok: true, token: event.data.token, origin: event.origin })
    }

    window.addEventListener('message', onMessage)

    // If the operator closes the popup without completing login, resolve so the
    // UI can re-enable its controls.
    const closedPoll: ReturnType<typeof setInterval> = setInterval(() => {
      let isClosed = false
      try {
        isClosed = openedPopup.closed
      } catch {
        // Cross-origin transient; treat as still open.
        isClosed = false
      }
      if (isClosed) settle({ ok: false, reason: 'closed' })
    }, 500)

    const timeoutId: ReturnType<typeof setTimeout> = setTimeout(
      () => settle({ ok: false, reason: 'timeout' }),
      timeoutMs,
    )
  })
}

/**
 * Derives the default expected origin for a provider login URL — the scheme +
 * host (+ port) of the source's own address. The operator can extend the
 * allowlist, but this gives a safe, non-wildcard default so the popup never
 * listens to `*`. Returns `null` for an unparseable / non-http(s) URL.
 */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

/**
 * Masks a credential for display. Never shows the middle of the secret; at most
 * a few leading characters so an operator can sanity-check which token is set.
 * Used for any on-screen echo — the raw value is never rendered directly.
 */
export function maskCredential(value: string): string {
  const visible = 3
  if (value.length <= visible) return '•'.repeat(8)
  return `${value.slice(0, visible)}${'•'.repeat(8)}`
}
