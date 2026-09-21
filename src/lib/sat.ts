/**
 * OSC Service Access Token (SAT) acquisition for the Open Live API.
 *
 * The studio NEVER holds the long-lived OSC Personal Access Token (PAT). The
 * PAT stays server-side in the open-live backend. The studio obtains a
 * short-lived SAT from the backend's server-side SAT-exchange endpoint
 * (`POST /api/v1/auth/token`, open-live PR #228) and caches it, refreshing
 * automatically 5 minutes before expiry.
 *
 * How the studio authenticates TO that endpoint:
 *   - OSC-hosted: the OSC reverse-proxy auth wall fronts the backend (the same
 *     wall that serves this SPA). The exchange request rides that session via
 *     `credentials: 'include'`; no client-side secret is needed or held.
 *   - Self-hosted: the backend's `API_KEY` guards `/api/v1/*`. The studio does
 *     NOT embed that key (doing so would recreate the plaintext-secret bug this
 *     change fixes); a same-origin/proxy session in front of the deployment is
 *     expected to gate access. See the PR body for the deployment contract.
 *
 * When the backend has no PAT configured (local dev, 503) or the studio is not
 * authorised, getApiToken() returns undefined and API requests are sent without
 * an Authorization header.
 */

import { BASE } from './base.js'

const SAT_ENDPOINT = '/api/v1/auth/token'
const REFRESH_BUFFER_MS = 5 * 60 * 1000
const OSC_COOKIE_DOMAIN = '.osaas.io'
// Cookie name the OSC reverse proxy expects for open-live REST/WS auth.
const OPEN_LIVE_SERVICE_ID = 'eyevinn-open-live'

// osc.bearer / osc.bearer.<token> — WS subprotocol convention (issue #144,
// osaas-lib-orchestrator#263, @osaas/orchestrator@4.11.0) that lets the OSC
// ingress gate's /authenticate auth_request accept a WS upgrade the same way
// it accepts REST: previously only the eyevinn-open-live.sat cookie,
// Authorization header, or x-jwt header. That cookie is scoped to the
// document host (#33's domain= removal) so it never reaches the backend
// subdomain on a cross-origin WS upgrade, and the `?token=` query param the
// gate has never supported is rejected before the request reaches open-live.
// Browsers cannot set arbitrary headers on a WS handshake, but can offer
// subprotocols via `new WebSocket(url, protocols)` — mirrors open-live's own
// self-hosted `openlive.bearer.<API_KEY>` scheme (open-live#49), generalized
// by the platform so any OSC service can use it.
const WS_SUBPROTOCOL_MARKER = 'osc.bearer'
const WS_SUBPROTOCOL_KEY_PREFIX = 'osc.bearer.'

/**
 * WS subprotocols to pass as the second argument to `new WebSocket(url, protocols)`
 * for the given SAT, or undefined when there is no token (self-hosted / not
 * authorised) — in which case the socket connects without offering any
 * subprotocol, same as before this scheme existed.
 */
export function wsAuthProtocols(token: string | undefined): string[] | undefined {
  if (!token) return undefined
  return [WS_SUBPROTOCOL_MARKER, `${WS_SUBPROTOCOL_KEY_PREFIX}${token}`]
}

interface SatCache {
  token: string
  expiresAt: number
}

let cache: SatCache | null = null
// In-flight promise so concurrent callers await the same exchange request
// instead of each firing their own, which would produce N requests on page load.
let inflight: Promise<string | undefined> | null = null

function isExpiringSoon(c: SatCache): boolean {
  return Date.now() >= c.expiresAt - REFRESH_BUFFER_MS
}

/**
 * Returns a valid SAT Bearer token for the Open Live API, or undefined if the
 * backend cannot mint one (no PAT configured server-side, or not authorised).
 * Throws only on unexpected exchange failures (misconfigured backend).
 */
export async function getApiToken(): Promise<string | undefined> {
  if (cache && !isExpiringSoon(cache)) return cache.token

  if (!inflight) {
    inflight = fetch(`${BASE}${SAT_ENDPOINT}`, {
      method: 'POST',
      // Ride the OSC proxy / same-origin session; the studio holds no secret.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      // The endpoint takes no caller-supplied input: the serviceId and target
      // are fixed server-side (anti-SSRF). Body is an empty object.
      body: JSON.stringify({}),
    })
      .then(async (res) => {
        // 503 = backend has no PAT configured (e.g. local dev) → behave as
        // "no auth": callers send requests without an Authorization header.
        if (res.status === 503) return undefined
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(`SAT exchange failed (${res.status}): ${body.slice(0, 200)}`)
        }
        // Contract (open-live#228): { token: string, expiry: number(seconds) }.
        const data = (await res.json()) as { token: string; expiry: number }
        cache = { token: data.token, expiresAt: data.expiry * 1000 }
        return cache.token
      })
      .finally(() => { inflight = null })
  }

  return inflight
}

export function isOnOsc(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.endsWith(OSC_COOKIE_DOMAIN)
}

/**
 * On OSC: sets the `eyevinn-open-live.sat` cookie scoped to the current subdomain
 * so OSC's reverse proxy authenticates both REST and WebSocket requests automatically.
 * On localhost: no-op — api.ts falls back to Authorization header instead.
 * Returns the SAT expiry in ms, or 0 if no SAT is available or not on OSC.
 */
export async function authenticateWithOpenLive(): Promise<number> {
  if (!isOnOsc()) return 0

  const sat = await getApiToken()
  if (!sat) return 0

  let maxAge = 3600 // default 1h if we cannot parse
  try {
    const parts = sat.split('.')
    if (parts.length < 3) throw new Error('Malformed JWT: expected 3 dot-separated parts')
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as unknown
    const exp = typeof (payload as Record<string, unknown>)?.['exp'] === 'number'
      ? (payload as { exp: number }).exp
      : 0
    if (exp > 0) {
      maxAge = Math.max(0, exp - Math.floor(Date.now() / 1000))
    }
  } catch (err) {
    // eslint-disable-next-line no-console -- surfaces JWT parse failures for diagnostics
    console.error('[sat] Failed to parse SAT JWT for cookie expiry — using 1h default:', err)
  }

  // Note: HttpOnly cannot be set via document.cookie (requires Set-Cookie response header).
  // The SAT is intentionally readable by JS so it can be sent as a Bearer token in API calls.
  // Compensating controls: cookie scoped to current subdomain only (no explicit domain= attribute,
  // so browser defaults to document.location.hostname), short token lifetime (1h).
  document.cookie = [
    `${OPEN_LIVE_SERVICE_ID}.sat=${encodeURIComponent('Bearer ' + sat)}`,
    `path=/`,
    `max-age=${maxAge}`,
    `SameSite=Lax`,
    `Secure`,
  ].join('; ')

  // Return expiry in ms (used by caller to schedule re-authentication)
  return maxAge > 0 ? (Math.floor(Date.now() / 1000) + maxAge) * 1000 : 0
}
