/**
 * Operator talkback client (studio#237, guest-talkback spec §5.2 / OLS-A).
 *
 * Connects one audio-only WHIP (talk) or WHEP (listen) session to a guest's
 * Open Intercom line through open-live's crew talkback proxy (open-live#599,
 * `src/routes/guests.ts`):
 *
 *   POST   /api/v1/productions/:id/guests/:guestId/talkback/{whip|whep}[?name=]
 *          Content-Type: application/sdp, complete offer → 201 SDP answer + Location
 *   DELETE /api/v1/productions/:id/guests/:guestId/talkback/{whip|whep}/:sessionId → 204
 *   Errors: 401, 404 (`Guest not found` / `Talkback unavailable`), 502,
 *           503 + Retry-After (manager rate limit, spec OQ8)
 *
 * Studio never talks to intercom-manager directly and never sees its key.
 *
 * Modelled on `whep.ts`, but `connectWhep` is not reused: this sends the crew
 * `Authorization` header, gathers ICE before the POST (the proxy has no PATCH,
 * so no trickle) and offers a single audio transceiver — `sendonly` for WHIP,
 * `recvonly` for WHEP. Plain `RTCPeerConnection` + `fetch`, no dependency.
 */
import { BASE } from './base.js'
import { authenticateWithOpenLive, getApiToken } from './sat.js'

export type TalkbackKind = 'whip' | 'whep'

/** How long to wait for ICE gathering before POSTing what we have (guest page uses the same idea). */
export const TALKBACK_ICE_GATHER_TIMEOUT_MS = 3000
/** Default wait before the single 503 retry when the proxy sends no usable `Retry-After` (spec OQ8). */
export const TALKBACK_DEFAULT_RETRY_AFTER_MS = 5000
/** Upper bound on an honoured `Retry-After`, so a hostile/odd header cannot park the UI. */
const TALKBACK_MAX_RETRY_AFTER_MS = 30000

/** A failed talkback connect. `status` is the HTTP status, or 0 for a network/ICE failure. */
export class TalkbackError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'TalkbackError'
  }
}

/** Crew talkback POST path for a guest (Studio builds crew paths from ids, spec §3.4). */
export function talkbackPath(productionId: string, guestId: string, kind: TalkbackKind): string {
  return `/api/v1/productions/${encodeURIComponent(productionId)}/guests/${encodeURIComponent(guestId)}/talkback/${kind}`
}

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP-date) into ms. Falls back
 * to the 5 s default when absent or unparseable, and clamps to a sane maximum.
 */
export function parseRetryAfterMs(header: string | null, now: number = Date.now()): number {
  if (header) {
    const trimmed = header.trim()
    if (/^\d+$/.test(trimmed)) {
      return Math.min(parseInt(trimmed, 10) * 1000, TALKBACK_MAX_RETRY_AFTER_MS)
    }
    const at = Date.parse(trimmed)
    if (Number.isFinite(at)) return Math.min(Math.max(0, at - now), TALKBACK_MAX_RETRY_AFTER_MS)
  }
  return TALKBACK_DEFAULT_RETRY_AFTER_MS
}

async function crewAuthHeaders(): Promise<Record<string, string>> {
  await authenticateWithOpenLive()
  const token = await getApiToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Best-effort ICE servers (TURN when configured) from open-live; `[]` on any failure. */
export async function fetchTalkbackIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`${BASE}/api/v1/ice-servers`, { headers: await crewAuthHeaders() })
    if (!res.ok) return []
    const body = (await res.json()) as { iceServers?: unknown }
    return Array.isArray(body.iceServers) ? (body.iceServers as RTCIceServer[]) : []
  } catch {
    return []
  }
}

/** Resolve once ICE gathering is complete, or after the timeout (POST with what we have). */
function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done()
    }
    const timer = setTimeout(done, timeoutMs)
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface ConnectTalkbackOptions {
  kind: TalkbackKind
  productionId: string
  guestId: string
  /** WHIP only: the (per-guest) mic track to publish. */
  track?: MediaStreamTrack
  /** Optional display name for the operator on the line (`?name=`; server default `Producer`). */
  name?: string
  iceServers?: RTCIceServer[]
  /** Called on every `connectionState` change after the answer is applied. */
  onConnectionState?: (state: RTCPeerConnectionState) => void
  /** WHEP only: called with each received remote track. */
  onTrack?: (track: MediaStreamTrack, stream: MediaStream) => void
  iceGatherTimeoutMs?: number
  /** Injected for tests; defaults to `setTimeout`-based sleep. */
  sleepFn?: (ms: number) => Promise<void>
}

export interface TalkbackSession {
  kind: TalkbackKind
  pc: RTCPeerConnection
  /** WHIP only: the audio sender, for `replaceTrack` on a mic change. */
  sender: RTCRtpSender | null
  /** Absolute session resource URL from `Location`, used for DELETE (a connect without one fails). */
  resourceUrl: string
  /** Close the PC and DELETE the crew session. Resolves with the DELETE status (0 = failed, warned). */
  close: () => Promise<number>
}

/**
 * Open one crew talkback session. Retries once on `503` after `Retry-After`
 * (default 5 s). Throws a `TalkbackError` (with the HTTP status) on failure;
 * the PC is closed in that case.
 */
export async function connectTalkback(opts: ConnectTalkbackOptions): Promise<TalkbackSession> {
  const { kind, productionId, guestId } = opts
  const sleepFn = opts.sleepFn ?? sleep
  const query = opts.name?.trim() ? `?name=${encodeURIComponent(opts.name.trim())}` : ''
  const url = `${BASE}${talkbackPath(productionId, guestId, kind)}${query}`

  const pc = new RTCPeerConnection({ iceServers: opts.iceServers ?? [] })
  let sender: RTCRtpSender | null = null
  try {
    if (kind === 'whip') {
      if (!opts.track) throw new TalkbackError('Talkback: WHIP needs a mic track', 0)
      const transceiver = pc.addTransceiver(opts.track, { direction: 'sendonly' })
      sender = transceiver.sender
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' })
      // Assign before setRemoteDescription — tracks can fire during it (see whep.ts).
      pc.ontrack = (event) => {
        opts.onTrack?.(event.track, event.streams[0] ?? new MediaStream([event.track]))
      }
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await waitForIceGathering(pc, opts.iceGatherTimeoutMs ?? TALKBACK_ICE_GATHER_TIMEOUT_MS)
    const sdp = pc.localDescription?.sdp ?? offer.sdp ?? ''

    let response: Response | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp', ...(await crewAuthHeaders()) },
          body: sdp,
        })
      } catch (err) {
        throw new TalkbackError(`Talkback: network error (${String(err)})`, 0)
      }
      if (response.status === 503 && attempt === 0) {
        await sleepFn(parseRetryAfterMs(response.headers.get('Retry-After')))
        continue
      }
      break
    }
    if (!response || response.status !== 201) {
      const status = response?.status ?? 0
      let message = `Talkback: unexpected status ${status}`
      try {
        const body = (await response?.json()) as { error?: unknown } | undefined
        if (typeof body?.error === 'string') message = body.error
      } catch { /* non-JSON error body */ }
      throw new TalkbackError(message, status)
    }

    // Without a readable `Location` the session can never be DELETEd, so it would
    // leak on the guest's intercom line. Cross-origin, `Location` is only readable
    // when open-live exposes it via `Access-Control-Expose-Headers` (open-live#607).
    // Treat it as a failed connect (inline "unavailable") instead of a silent leak.
    const location = response.headers.get('Location')
    if (!location) {
      // eslint-disable-next-line no-console -- the server-side session is orphaned; make it diagnosable
      console.warn(
        `[talkback] ${kind} POST returned 201 without a readable Location; the crew session cannot be deleted. ` +
          'Check that open-live exposes Location via CORS (Access-Control-Expose-Headers).',
      )
      throw new TalkbackError('Talkback: server response has no readable Location (CORS expose-headers?)', 0)
    }
    let resourceUrl: string
    try {
      resourceUrl = new URL(location, url).toString()
    } catch {
      resourceUrl = location
    }

    const answer = await response.text()
    pc.onconnectionstatechange = () => opts.onConnectionState?.(pc.connectionState)
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })

    let closed: Promise<number> | null = null
    const close = (): Promise<number> => {
      if (closed) return closed
      pc.onconnectionstatechange = null
      pc.ontrack = null
      pc.close()
      closed = crewAuthHeaders()
        .then((headers) => fetch(resourceUrl, { method: 'DELETE', headers }))
        .then((res) => res.status)
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console -- surfaces best-effort cleanup failures for diagnostics
          console.warn(`[talkback] DELETE ${kind} session failed (best-effort):`, err)
          return 0
        })
      return closed
    }

    return { kind, pc, sender, resourceUrl, close }
  } catch (err) {
    pc.close()
    if (err instanceof TalkbackError) throw err
    throw new TalkbackError(`Talkback: ${err instanceof Error ? err.message : String(err)}`, 0)
  }
}
