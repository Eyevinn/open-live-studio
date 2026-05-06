/**
 * OSC Service Access Token (SAT) exchange for the Open Live API.
 *
 * The studio reads OSC_PAT from the runtime env (injected by
 * docker-entrypoint.sh from the OSC parameter store).  On first API call
 * it exchanges the PAT for a short-lived SAT and caches it, refreshing
 * automatically 5 minutes before expiry.
 *
 * When no PAT is configured (local dev), getApiToken() returns undefined
 * and API requests are sent without an Authorization header.
 *
 * authenticateWithOpenLive() writes the SAT as the OSC-standard
 * `eyevinn-open-live.sat` cookie on `.osaas.io`, which OSC's reverse proxy
 * recognises for both REST and WebSocket requests — no open-live code changes
 * needed.
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
  return (
    (typeof window !== 'undefined' &&
      (window as unknown as { _env_?: { OSC_PAT?: string } })._env_?.OSC_PAT) ||
    (import.meta.env.OSC_PAT as string | undefined) ||
    undefined
  )
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

  const parts = sat.split('.')
  const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp: number }
  const maxAge = payload.exp - Math.floor(Date.now() / 1000)

  document.cookie = [
    `${OPEN_LIVE_SERVICE_ID}.sat=${encodeURIComponent('Bearer ' + sat)}`,
    `domain=${OSC_COOKIE_DOMAIN}`,
    `path=/`,
    `max-age=${maxAge}`,
    `SameSite=Lax`,
    `Secure`,
  ].join('; ')

  return payload.exp * 1000
}
