/**
 * OSC Service Access Token (SAT) exchange for the Open Live API.
 *
 * The studio reads VITE_API_PAT from the runtime env (injected by
 * docker-entrypoint.sh from the OSC parameter store).  On first API call
 * it exchanges the PAT for a short-lived SAT and caches it, refreshing
 * automatically 5 minutes before expiry.
 *
 * When no PAT is configured (local dev), getApiToken() returns undefined
 * and API requests are sent without an Authorization header.
 */

const TOKEN_EXCHANGE_URL = 'https://token.svc.prod.osaas.io/servicetoken'
const OPEN_LIVE_SERVICE_ID = 'eyevinn-open-live'
const REFRESH_BUFFER_MS = 5 * 60 * 1000

interface SatCache {
  token: string
  expiresAt: number
}

let cache: SatCache | null = null

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

  const res = await fetch(TOKEN_EXCHANGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      'x-pat-jwt': `Bearer ${pat}`,
    },
    body: JSON.stringify({ serviceId: OPEN_LIVE_SERVICE_ID }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SAT exchange failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as { token: string; expiry: number }
  cache = { token: data.token, expiresAt: data.expiry * 1000 }
  return cache.token
}
