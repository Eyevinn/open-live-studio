/**
 * OSC Service Access Token (SAT) exchange for the Open Live API.
 *
 * OSC_PAT is baked into the bundle at build time (Docker build arg).
 * On first API call it is exchanged for a short-lived SAT which is cached
 * and refreshed automatically 5 minutes before expiry.
 *
 * When no PAT is configured (local dev), getApiToken() returns undefined
 * and API requests are sent without an Authorization header.
 */

const TOKEN_EXCHANGE_URL = 'https://token.svc.prod.osaas.io/servicetoken'
const OPEN_LIVE_SERVICE_ID = 'eyevinn-open-live'
const REFRESH_BUFFER_MS = 5 * 60 * 1000
const OSC_COOKIE_DOMAIN = '.osaas.io'

interface SatCache {
  token: string
  expiresAt: number
}

let cache: SatCache | null = null
// In-flight promise so concurrent callers await the same exchange request
// instead of each firing their own, which would produce N requests on page load.
let inflight: Promise<string> | null = null

function isExpiringSoon(c: SatCache): boolean {
  return Date.now() >= c.expiresAt - REFRESH_BUFFER_MS
}

function getPat(): string | undefined {
  return window._env_?.OSC_PAT || import.meta.env.OSC_PAT || undefined
}

/**
 * Returns a valid SAT Bearer token for the Open Live API, or undefined if no
 * PAT is configured.  Throws if the exchange fails (misconfigured PAT).
 */
export async function getApiToken(): Promise<string | undefined> {
  const pat = getPat()
  if (!pat) return undefined

  if (cache && !isExpiringSoon(cache)) return cache.token

  if (!inflight) {
    inflight = fetch(TOKEN_EXCHANGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json',
        'x-pat-jwt': `Bearer ${pat}`,
      },
      body: JSON.stringify({ serviceId: OPEN_LIVE_SERVICE_ID }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text()
          throw new Error(`SAT exchange failed (${res.status}): ${body.slice(0, 200)}`)
        }
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
 * On OSC: sets the `eyevinn-open-live.sat` cookie on `.osaas.io` so OSC's
 * reverse proxy authenticates both REST and WebSocket requests automatically.
 * On localhost: no-op — api.ts falls back to Authorization header instead.
 * Returns the SAT expiry in ms, or 0 if no PAT is configured or not on OSC.
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
    console.error('[sat] Failed to parse SAT JWT for cookie expiry — using 1h default:', err)
  }

  // Note: HttpOnly cannot be set via document.cookie (requires Set-Cookie response header).
  // The SAT is intentionally readable by JS so it can be sent as a Bearer token in API calls.
  // Compensating control: strict same-origin policy + short token lifetime (1h).
  document.cookie = [
    `${OPEN_LIVE_SERVICE_ID}.sat=${encodeURIComponent('Bearer ' + sat)}`,
    `domain=${OSC_COOKIE_DOMAIN}`,
    `path=/`,
    `max-age=${maxAge}`,
    `SameSite=Lax`,
    `Secure`,
  ].join('; ')

  // Return expiry in ms (used by caller to schedule re-authentication)
  return maxAge > 0 ? (Math.floor(Date.now() / 1000) + maxAge) * 1000 : 0
}
