import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakePeerConnection, FakeTrack, makeTalkbackFetch } from './talkback.test-helpers'

vi.mock('./base.js', () => ({ BASE: 'http://ol.test' }))
vi.mock('./sat.js', () => ({
  authenticateWithOpenLive: vi.fn(async () => 0),
  getApiToken: vi.fn(async () => 'crew-token'),
}))

const { connectTalkback, parseRetryAfterMs, talkbackPath, TalkbackError, TALKBACK_DEFAULT_RETRY_AFTER_MS } = await import('./talkback')

beforeEach(() => {
  FakePeerConnection.instances = []
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('talkbackPath', () => {
  it('builds the crew route from production + guest ids', () => {
    expect(talkbackPath('p 1', 'g/2', 'whip')).toBe('/api/v1/productions/p%201/guests/g%2F2/talkback/whip')
  })
})

describe('parseRetryAfterMs', () => {
  it('reads delta-seconds', () => expect(parseRetryAfterMs('2')).toBe(2000))
  it('defaults to 5 s when absent or junk', () => {
    expect(parseRetryAfterMs(null)).toBe(TALKBACK_DEFAULT_RETRY_AFTER_MS)
    expect(parseRetryAfterMs('soon')).toBe(TALKBACK_DEFAULT_RETRY_AFTER_MS)
  })
  it('reads an HTTP-date', () => {
    const now = Date.parse('2026-10-28T10:00:00Z')
    expect(parseRetryAfterMs('Wed, 28 Oct 2026 10:00:03 GMT', now)).toBe(3000)
  })
  it('clamps very long waits', () => expect(parseRetryAfterMs('3600')).toBe(30000))
})

describe('connectTalkback', () => {
  it('WHIP: one sendonly audio transceiver, non-trickle SDP POST with the crew Authorization, DELETE on Location', async () => {
    const { fetch, calls } = makeTalkbackFetch()
    vi.stubGlobal('fetch', fetch)
    const track = new FakeTrack('mic')
    const session = await connectTalkback({
      kind: 'whip', productionId: 'p1', guestId: 'g1', track: track as unknown as MediaStreamTrack,
    })
    const pc = FakePeerConnection.instances[0]!
    expect(pc.transceivers).toHaveLength(1)
    expect(pc.transceivers[0]).toMatchObject({ trackOrKind: track, direction: 'sendonly' })
    expect(calls[0]).toMatchObject({
      url: 'http://ol.test/api/v1/productions/p1/guests/g1/talkback/whip',
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp', Authorization: 'Bearer crew-token' },
    })
    expect(calls[0]!.body).toBe(pc.localDescription?.sdp)
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' })
    expect(session.sender).toBe(pc.transceivers[0]!.sender)

    const status = await session.close()
    expect(pc.closed).toBe(true)
    expect(status).toBe(204)
    expect(calls[1]).toMatchObject({
      method: 'DELETE',
      url: 'http://ol.test/api/v1/productions/p1/guests/g1/talkback/whip/00000000-0000-4000-8000-000000000001',
      headers: { Authorization: 'Bearer crew-token' },
    })
    // Idempotent: a second close issues no second DELETE.
    await session.close()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
  })

  it('WHEP: one recvonly audio transceiver and surfaces received tracks; passes ?name=', async () => {
    const { fetch, calls } = makeTalkbackFetch()
    vi.stubGlobal('fetch', fetch)
    const onTrack = vi.fn()
    await connectTalkback({ kind: 'whep', productionId: 'p1', guestId: 'g1', name: 'Jane Producer', onTrack })
    const pc = FakePeerConnection.instances[0]!
    expect(pc.transceivers).toEqual([expect.objectContaining({ trackOrKind: 'audio', direction: 'recvonly' })])
    expect(calls[0]!.url).toBe('http://ol.test/api/v1/productions/p1/guests/g1/talkback/whep?name=Jane%20Producer')
    const remote = new FakeTrack('line')
    pc.ontrack?.({ track: remote, streams: [{ id: 's' } as never] })
    expect(onTrack).toHaveBeenCalledWith(remote, { id: 's' })
  })

  it('retries once after Retry-After on 503, then succeeds', async () => {
    const { fetch, calls } = makeTalkbackFetch((call, n) =>
      call.method === 'POST' && n === 1
        ? new Response(JSON.stringify({ error: 'Rate limited' }), { status: 503, headers: { 'Retry-After': '2' } })
        : undefined,
    )
    vi.stubGlobal('fetch', fetch)
    const sleepFn = vi.fn(async () => {})
    await connectTalkback({ kind: 'whep', productionId: 'p1', guestId: 'g1', sleepFn })
    expect(sleepFn).toHaveBeenCalledWith(2000)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2)
  })

  it('gives up after the single 503 retry (default 5 s wait)', async () => {
    const { fetch, calls } = makeTalkbackFetch((call) =>
      call.method === 'POST' ? new Response(JSON.stringify({ error: 'Rate limited' }), { status: 503 }) : undefined,
    )
    vi.stubGlobal('fetch', fetch)
    const sleepFn = vi.fn(async () => {})
    await expect(connectTalkback({ kind: 'whep', productionId: 'p1', guestId: 'g1', sleepFn }))
      .rejects.toMatchObject({ status: 503, message: 'Rate limited' })
    expect(sleepFn).toHaveBeenCalledWith(TALKBACK_DEFAULT_RETRY_AFTER_MS)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2)
    expect(FakePeerConnection.instances[0]!.closed).toBe(true)
  })

  it.each([
    [404, 'Talkback unavailable'],
    [404, 'Guest not found'],
    [502, 'Bad Gateway'],
    [401, 'Unauthorized'],
  ])('throws a TalkbackError carrying %i "%s" and closes the PC', async (status, error) => {
    const { fetch } = makeTalkbackFetch((call) =>
      call.method === 'POST' ? new Response(JSON.stringify({ error, statusCode: status }), { status }) : undefined,
    )
    vi.stubGlobal('fetch', fetch)
    const err = await connectTalkback({ kind: 'whep', productionId: 'p1', guestId: 'g1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TalkbackError)
    expect(err).toMatchObject({ status, message: error })
    expect(FakePeerConnection.instances[0]!.closed).toBe(true)
  })

  it('fails a 201 with no readable Location (cross-origin, not CORS-exposed): closes the PC and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fetch, calls } = makeTalkbackFetch((call) =>
      // What the browser hands back when `Location` is not in Access-Control-Expose-Headers.
      call.method === 'POST' ? new Response('v=0 answer', { status: 201, headers: { 'Content-Type': 'application/sdp' } }) : undefined,
    )
    vi.stubGlobal('fetch', fetch)
    const err = await connectTalkback({ kind: 'whip', productionId: 'p1', guestId: 'g1', track: new FakeTrack('mic') as unknown as MediaStreamTrack })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TalkbackError)
    expect(err).toMatchObject({ status: 0 })
    expect((err as Error).message).toMatch(/Location/)
    const pc = FakePeerConnection.instances[0]!
    expect(pc.closed).toBe(true)
    expect(pc.remoteDescription).toBeNull()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/without a readable Location/))
    warn.mockRestore()
  })

  it('warns when the DELETE on close fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fetch } = makeTalkbackFetch((call) => {
      if (call.method === 'DELETE') throw new TypeError('Failed to fetch')
      return undefined
    })
    vi.stubGlobal('fetch', fetch)
    const session = await connectTalkback({ kind: 'whep', productionId: 'p1', guestId: 'g1' })
    await expect(session.close()).resolves.toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/DELETE whep session failed/), expect.any(TypeError))
    warn.mockRestore()
  })

  it('maps a network failure to status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(connectTalkback({ kind: 'whep', productionId: 'p1', guestId: 'g1' })).rejects.toMatchObject({ status: 0 })
  })
})
