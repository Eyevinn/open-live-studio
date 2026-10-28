import { describe, expect, it, vi } from 'vitest'
import { TalkbackManager, type TalkbackAudioSink } from './talkback-manager'
import { TalkbackError, type ConnectTalkbackOptions, type TalkbackSession, type TalkbackKind } from './talkback'
import { FakeSender, FakeStream, FakeTrack } from './talkback.test-helpers'

vi.mock('./base.js', () => ({ BASE: 'http://ol.test' }))

interface FakeSession {
  kind: TalkbackKind
  guestId: string
  opts: ConnectTalkbackOptions
  closed: boolean
  sender: FakeSender | null
}

function setup(failFor?: (opts: ConnectTalkbackOptions) => Error | undefined) {
  const sessions: FakeSession[] = []
  const connect = vi.fn(async (opts: ConnectTalkbackOptions): Promise<TalkbackSession> => {
    const err = failFor?.(opts)
    if (err) throw err
    const rec: FakeSession = {
      kind: opts.kind,
      guestId: opts.guestId,
      opts,
      closed: false,
      sender: opts.kind === 'whip' ? new FakeSender(opts.track as unknown as FakeTrack) : null,
    }
    sessions.push(rec)
    return {
      kind: opts.kind,
      pc: {} as RTCPeerConnection,
      sender: rec.sender as unknown as RTCRtpSender | null,
      resourceUrl: `x/${opts.kind}`,
      close: async () => { rec.closed = true; return 204 },
    }
  })
  const audios: TalkbackAudioSink[] = []
  const manager = new TalkbackManager({
    productionId: 'p1',
    connect,
    getIceServers: async () => [],
    createAudio: () => {
      const a: TalkbackAudioSink = {
        srcObject: null, muted: false, autoplay: false,
        play: vi.fn(async () => {}), pause: vi.fn(),
      }
      audios.push(a)
      return a
    },
  })
  const mic = new FakeTrack('mic')
  manager.setMicStream(new FakeStream([mic]) as unknown as MediaStream)
  /** The per-guest mic clone published on a guest's WHIP sender. */
  const talkTrack = (guestId: string) =>
    sessions.find((s) => s.kind === 'whip' && s.guestId === guestId && !s.closed)?.sender?.track as FakeTrack | undefined
  return { manager, sessions, connect, audios, mic, talkTrack }
}

describe('TalkbackManager open', () => {
  it('connects WHEP and WHIP with a disabled per-guest clone ahead of the first Talk press', async () => {
    const { manager, sessions, mic, talkTrack } = setup()
    await manager.open('a')
    expect(sessions.map((s) => s.kind).sort()).toEqual(['whep', 'whip'])
    expect(talkTrack('a')).not.toBe(mic)
    expect(talkTrack('a')!.enabled).toBe(false)
    expect(manager.getSnapshot()['a']).toMatchObject({ status: 'open', talking: false, listening: true })
    expect(manager.wantsMic()).toBe(true)
  })

  it('waits for the mic when it is not acquired yet, and fails the guest if it cannot be', async () => {
    const { manager, connect } = setup()
    manager.setMicStream(null)
    const opening = manager.open('a')
    expect(manager.getSnapshot()['a']?.status).toBe('connecting')
    manager.micFailed()
    await opening
    expect(connect).not.toHaveBeenCalled()
    expect(manager.getSnapshot()['a']).toMatchObject({ status: 'unavailable', error: 'Microphone unavailable' })
    expect(manager.wantsMic()).toBe(false)
  })
})

describe('TalkbackManager push-to-talk on the per-guest track', () => {
  it('press → enabled, release → disabled; cancel-hold (blur/visibility/pointercancel) releases', async () => {
    const { manager, talkTrack } = setup()
    await manager.open('a')
    manager.press('a')
    expect(talkTrack('a')!.enabled).toBe(true)
    expect(manager.getSnapshot()['a']?.talking).toBe(true)
    manager.release('a')
    expect(talkTrack('a')!.enabled).toBe(false)
    manager.press('a')
    manager.cancelHold()
    expect(talkTrack('a')!.enabled).toBe(false)
  })

  it('latch keeps the track enabled; latching guest B releases guest A', async () => {
    const { manager, talkTrack } = setup()
    await manager.open('a')
    await manager.open('b')
    manager.toggleLatch('a')
    manager.cancelHold()
    expect(talkTrack('a')!.enabled).toBe(true)
    manager.toggleLatch('b')
    expect(talkTrack('a')!.enabled).toBe(false)
    expect(talkTrack('b')!.enabled).toBe(true)
    expect(manager.getSnapshot()['a']?.latched).toBe(false)
    expect(manager.getSnapshot()['b']?.latched).toBe(true)
  })

  it('a mic change swaps a fresh clone onto open senders, keeping talk state', async () => {
    const { manager, talkTrack } = setup()
    await manager.open('a')
    await manager.open('b')
    manager.toggleLatch('a')
    const oldA = talkTrack('a')!
    const newMic = new FakeTrack('mic2')
    manager.setMicStream(new FakeStream([newMic]) as unknown as MediaStream)
    await Promise.resolve()
    expect(talkTrack('a')!.id).toMatch(/^mic2-clone/)
    expect(talkTrack('a')!.enabled).toBe(true)
    expect(talkTrack('b')!.id).toMatch(/^mic2-clone/)
    expect(talkTrack('b')!.enabled).toBe(false)
    expect(oldA.readyState).toBe('ended')
  })
})

describe('TalkbackManager listen', () => {
  it('plays the line while open; Listen mute defaults to listening', async () => {
    const { manager, sessions, audios } = setup()
    await manager.open('a')
    const whep = sessions.find((s) => s.kind === 'whep')!
    const remote = { id: 'line' } as unknown as MediaStream
    whep.opts.onTrack?.({} as MediaStreamTrack, remote)
    expect(audios[0]).toMatchObject({ srcObject: remote, muted: false, autoplay: true })
    expect(audios[0]!.play).toHaveBeenCalled()
    manager.setListening('a', false)
    expect(audios[0]!.muted).toBe(true)
    expect(manager.getSnapshot()['a']?.listening).toBe(false)
  })
})

describe('TalkbackManager teardown and errors', () => {
  it('close() closes both sessions (both DELETEs) and stops the clone', async () => {
    const { manager, sessions, talkTrack } = setup()
    await manager.open('a')
    const clone = talkTrack('a')!
    expect(await manager.close('a')).toEqual([204, 204])
    expect(sessions.every((s) => s.closed)).toBe(true)
    expect(clone.readyState).toBe('ended')
    expect(manager.getSnapshot()['a']).toBeUndefined()
    expect(manager.wantsMic()).toBe(false)
  })

  it('retainOnly closes guests that left, leaving others untouched', async () => {
    const { manager, sessions } = setup()
    await manager.open('a')
    await manager.open('b')
    manager.retainOnly(['b'])
    expect(sessions.filter((s) => s.guestId === 'a').every((s) => s.closed)).toBe(true)
    expect(sessions.filter((s) => s.guestId === 'b').some((s) => s.closed)).toBe(false)
  })

  it('a guest closed while connecting tears down the sessions that land later', async () => {
    const { manager, sessions } = setup()
    const opening = manager.open('a')
    void manager.close('a')
    await opening
    expect(sessions.every((s) => s.closed)).toBe(true)
    expect(manager.getSnapshot()['a']).toBeUndefined()
  })

  it.each([404, 502])('a %i on one leg marks only that guest unavailable and closes the other leg', async (status) => {
    const { manager, sessions } = setup((o) =>
      o.guestId === 'a' && o.kind === 'whip' ? new TalkbackError('Talkback unavailable', status) : undefined,
    )
    await manager.open('a')
    await manager.open('b')
    expect(manager.getSnapshot()['a']).toMatchObject({ status: 'unavailable' })
    expect(manager.getSnapshot()['a']?.error).toContain(String(status))
    expect(sessions.find((s) => s.guestId === 'a' && s.kind === 'whep')?.closed).toBe(true)
    expect(manager.getSnapshot()['b']?.status).toBe('open')
  })

  it('PC failed after open marks the guest unavailable and closes both legs', async () => {
    const { manager, sessions } = setup()
    await manager.open('a')
    manager.toggleLatch('a')
    sessions[0]!.opts.onConnectionState?.('failed')
    expect(manager.getSnapshot()['a']).toMatchObject({ status: 'unavailable', latched: false })
    expect(sessions.every((s) => s.closed)).toBe(true)
  })

  it('a leg failing while the other is still connecting never ends up open', async () => {
    let releaseWhip: () => void = () => {}
    const { manager, sessions, connect } = setup()
    const base = connect.getMockImplementation()!
    connect.mockImplementation(async (opts) => {
      const session = await base(opts)
      if (opts.kind === 'whip') await new Promise<void>((r) => { releaseWhip = r })
      return session
    })
    const opening = manager.open('a')
    await vi.waitFor(() => expect(sessions).toHaveLength(2))
    sessions.find((s) => s.kind === 'whep')!.opts.onConnectionState?.('failed')
    releaseWhip()
    await opening
    expect(manager.getSnapshot()['a']?.status).toBe('unavailable')
    expect(sessions.every((s) => s.closed)).toBe(true)
  })

  it('Retry from unavailable reconnects', async () => {
    let fail = true
    const { manager } = setup(() => (fail ? new TalkbackError('Bad Gateway', 502) : undefined))
    await manager.open('a')
    expect(manager.getSnapshot()['a']?.status).toBe('unavailable')
    fail = false
    await manager.open('a')
    expect(manager.getSnapshot()['a']?.status).toBe('open')
  })

  it('closeAll tears down every guest', async () => {
    const { manager, sessions } = setup()
    await manager.open('a')
    await manager.open('b')
    expect(await manager.closeAll()).toHaveLength(4)
    expect(sessions.every((s) => s.closed)).toBe(true)
    expect(manager.getSnapshot()).toEqual({})
  })
})
