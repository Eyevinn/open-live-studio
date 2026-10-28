/**
 * Test doubles for the talkback media layer (studio#237). Imported by
 * `talkback*.test.ts(x)` only — never by app code.
 */

export class FakeTrack {
  enabled = true
  readyState: 'live' | 'ended' = 'live'
  readonly kind = 'audio'
  constructor(public readonly id: string) {}
  private clones = 0
  clone(): FakeTrack {
    this.clones += 1
    return new FakeTrack(`${this.id}-clone${this.clones}`)
  }
  stop(): void {
    this.readyState = 'ended'
  }
}

export class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getAudioTracks(): FakeTrack[] { return this.tracks }
  getTracks(): FakeTrack[] { return this.tracks }
}

export class FakeSender {
  constructor(public track: FakeTrack | null) {}
  replaceTrack(track: FakeTrack | null): Promise<void> {
    this.track = track
    return Promise.resolve()
  }
}

export interface FakeTransceiverRecord {
  trackOrKind: FakeTrack | string
  direction: string
  sender: FakeSender
}

/** Minimal RTCPeerConnection stand-in: offer/answer, gathering completes immediately. */
export class FakePeerConnection {
  static instances: FakePeerConnection[] = []
  transceivers: FakeTransceiverRecord[] = []
  iceGatheringState: RTCIceGatheringState = 'complete'
  connectionState: RTCPeerConnectionState = 'new'
  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  closed = false
  ontrack: ((ev: { track: FakeTrack; streams: FakeStream[] }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor(public readonly config: RTCConfiguration = {}) {
    FakePeerConnection.instances.push(this)
  }

  addTransceiver(trackOrKind: FakeTrack | string, init: { direction: string }): { sender: FakeSender } {
    const sender = new FakeSender(typeof trackOrKind === 'string' ? null : trackOrKind)
    this.transceivers.push({ trackOrKind, direction: init.direction, sender })
    return { sender }
  }

  async createOffer(): Promise<{ type: 'offer'; sdp: string }> {
    return { type: 'offer', sdp: `v=0 offer ${this.transceivers.map((t) => t.direction).join(',')}` }
  }

  async setLocalDescription(desc: { type: string; sdp: string }): Promise<void> {
    this.localDescription = desc
  }

  async setRemoteDescription(desc: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = desc
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  close(): void {
    this.closed = true
    this.connectionState = 'closed'
  }

  /** Simulate a connection-state transition. */
  setConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }
}

export interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/**
 * A scripted `fetch`: crew talkback POSTs answer `201` with a Location (unless
 * `respond` overrides), DELETEs answer `204`. Records every call.
 */
export function makeTalkbackFetch(
  respond?: (call: FetchCall, attempt: number) => Response | undefined,
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  let session = 0
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    }
    calls.push(call)
    const custom = respond?.(call, calls.filter((c) => c.url === call.url && c.method === call.method).length)
    if (custom) return custom
    if (call.method === 'DELETE') return new Response(null, { status: 204 })
    if (call.method === 'POST' && /\/talkback\/(whip|whep)/.test(call.url)) {
      session += 1
      const path = new URL(call.url).pathname
      const id = `00000000-0000-4000-8000-${String(session).padStart(12, '0')}`
      return new Response('v=0 answer', {
        status: 201,
        headers: { Location: `${path}/${id}`, ETag: id, 'Content-Type': 'application/sdp' },
      })
    }
    return new Response(JSON.stringify({ iceServers: [] }), { status: 200 })
  }
  return { fetch: fn as typeof fetch, calls }
}
