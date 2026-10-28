/**
 * Per-guest operator talkback sessions for the Guests panel (studio#237,
 * guest-talkback spec §5.2 / OLS-A).
 *
 * Owns, per guest: a WHEP session (listen), a WHIP session (talk) publishing a
 * per-guest clone of the shared mic track, and the <audio> element that plays
 * the line. Talk state (PTT + single latch) is the pure `talkReducer`; this
 * class maps it onto each clone's `enabled`. Plain TS (no React) so the
 * lifecycle is unit-testable; `useGuestTalkback` wires it to the stores.
 *
 * Isolation: every failure is caught and lands on that guest's entry as an
 * `unavailable` state, so one guest's talkback can never affect another guest
 * or the rest of the controller.
 */
import {
  connectTalkback as defaultConnect,
  fetchTalkbackIceServers,
  TalkbackError,
  type ConnectTalkbackOptions,
  type TalkbackSession,
} from './talkback'
import { INITIAL_TALK_STATE, isTalking, talkReducer, type TalkAction, type TalkState } from './talkback-ptt'

export type GuestTalkbackStatus = 'connecting' | 'open' | 'unavailable'

/** UI snapshot of one guest's talkback. Absent from the map = talkback closed. */
export interface GuestTalkbackView {
  status: GuestTalkbackStatus
  /** Detail for an `unavailable` entry (backend message / failure cause). */
  error?: string
  /** Per-guest Listen mute; listening defaults on. */
  listening: boolean
  /** Operator mic currently reaches this guest (held or latched). */
  talking: boolean
  latched: boolean
  held: boolean
}

export type TalkbackSnapshot = Readonly<Record<string, GuestTalkbackView>>

/** Minimal media-element surface used for the line's audio (injectable for tests). */
export interface TalkbackAudioSink {
  srcObject: MediaProvider | null
  muted: boolean
  autoplay: boolean
  play: () => Promise<void>
  pause: () => void
  setSinkId?: (sinkId: string) => Promise<void>
}

export interface TalkbackManagerDeps {
  productionId: string
  connect?: (opts: ConnectTalkbackOptions) => Promise<TalkbackSession>
  getIceServers?: () => Promise<RTCIceServer[]>
  createAudio?: () => TalkbackAudioSink
}

interface Entry {
  status: GuestTalkbackStatus
  error?: string
  listening: boolean
  track: MediaStreamTrack | null
  whip: TalkbackSession | null
  whep: TalkbackSession | null
  audio: TalkbackAudioSink | null
}

interface MicWaiter {
  resolve: (stream: MediaStream) => void
  reject: (err: Error) => void
}

/** Whether this browser can route an element's output to a chosen device. */
export function supportsSetSinkId(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
}

function failureMessage(err: unknown): string {
  if (err instanceof TalkbackError) {
    if (err.status === 0) return err.message.replace(/^Talkback: /, '')
    return `${err.message} (${err.status})`
  }
  return err instanceof Error ? err.message : String(err)
}

export class TalkbackManager {
  private readonly productionId: string
  private readonly connect: (opts: ConnectTalkbackOptions) => Promise<TalkbackSession>
  private readonly getIceServers: () => Promise<RTCIceServer[]>
  private readonly createAudio: () => TalkbackAudioSink

  private entries = new Map<string, Entry>()
  private talk: TalkState = INITIAL_TALK_STATE
  private mic: MediaStream | null = null
  private micWaiters: MicWaiter[] = []
  private sinkId: string | null = null
  private snapshot: TalkbackSnapshot = {}
  private listeners = new Set<() => void>()

  constructor(deps: TalkbackManagerDeps) {
    this.productionId = deps.productionId
    this.connect = deps.connect ?? defaultConnect
    this.getIceServers = deps.getIceServers ?? fetchTalkbackIceServers
    this.createAudio = deps.createAudio ?? (() => new Audio() as TalkbackAudioSink)
  }

  // ── Subscription (useSyncExternalStore) ────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): TalkbackSnapshot => this.snapshot

  /** True while any guest's talkback is connecting or open — the mic is held only then. */
  wantsMic(): boolean {
    for (const e of this.entries.values()) if (e.status !== 'unavailable') return true
    return false
  }

  /** Guest ids with an entry (any status). */
  guestIds(): string[] {
    return [...this.entries.keys()]
  }

  private emit(): void {
    const next: Record<string, GuestTalkbackView> = {}
    for (const [guestId, e] of this.entries) {
      next[guestId] = {
        status: e.status,
        ...(e.error ? { error: e.error } : {}),
        listening: e.listening,
        talking: e.status === 'open' && isTalking(this.talk, guestId),
        latched: this.talk.latched === guestId,
        held: this.talk.held === guestId,
      }
    }
    this.snapshot = next
    this.listeners.forEach((l) => l())
  }

  // ── Mic ────────────────────────────────────────────────────────────────────

  /**
   * The shared mic stream from `useIntercomAudio` (or null while released /
   * re-acquiring). A new stream — e.g. after a mic-device change — replaces the
   * per-guest clone on every open WHIP sender, keeping each one's talk state.
   */
  setMicStream(stream: MediaStream | null): void {
    if (stream === this.mic) return
    this.mic = stream
    if (!stream) return
    const waiters = this.micWaiters
    this.micWaiters = []
    waiters.forEach((w) => w.resolve(stream))
    const source = stream.getAudioTracks()[0]
    if (!source) return
    for (const [guestId, e] of this.entries) {
      if (!e.whip?.sender || !e.track) continue
      const clone = source.clone()
      clone.enabled = isTalking(this.talk, guestId)
      const old = e.track
      e.track = clone
      e.whip.sender.replaceTrack(clone).then(
        () => old.stop(),
        (err: unknown) => {
          // eslint-disable-next-line no-console -- diagnostics for a failed device swap; talkback stays on the old device
          console.warn('[talkback] replaceTrack failed:', err)
          e.track = old
          clone.stop()
        },
      )
    }
  }

  /**
   * The mic could not be acquired. Every guest still waiting for it becomes
   * unavailable, and so does every guest that already holds a clone: this also
   * fires on a re-acquire after a device change (e.g. an unplugged device picked
   * with `deviceId: { exact }`), and those clones belong to the stream that was
   * just released. Failing them clears `wantsMic()`, so the next Open/Retry
   * requests the mic again instead of staying stuck with no stream.
   */
  micFailed(reason = 'Microphone unavailable'): void {
    this.rejectMicWaiters(reason)
    // Waiting entries fail through their own rejected `waitForMic()`; they hold no clone yet.
    for (const [guestId, e] of [...this.entries]) {
      if (e.status !== 'unavailable' && (e.status === 'open' || e.track)) this.fail(guestId, e, reason)
    }
  }

  private rejectMicWaiters(reason: string): void {
    const waiters = this.micWaiters
    this.micWaiters = []
    waiters.forEach((w) => w.reject(new Error(reason)))
  }

  private waitForMic(): Promise<MediaStream> {
    if (this.mic) return Promise.resolve(this.mic)
    return new Promise((resolve, reject) => this.micWaiters.push({ resolve, reject }))
  }

  /** Output device for the line audio (`setSinkId` where supported; null = system default). */
  setSinkId(sinkId: string | null): void {
    this.sinkId = sinkId
    for (const e of this.entries.values()) if (e.audio) this.applySink(e.audio)
  }

  private applySink(audio: TalkbackAudioSink): void {
    if (typeof audio.setSinkId !== 'function') return
    audio.setSinkId(this.sinkId ?? '').catch((err: unknown) => {
      // eslint-disable-next-line no-console -- unsupported/denied output device falls back to the system default
      console.warn('[talkback] setSinkId failed; using the system default output:', err)
    })
  }

  // ── Open / close ───────────────────────────────────────────────────────────

  /**
   * Open talkback to a guest: acquire the mic, then connect WHEP (listen) and
   * WHIP (talk, clone disabled) ahead of the first Talk press. A no-op while
   * already connecting/open; retries from `unavailable`.
   */
  async open(guestId: string): Promise<void> {
    const existing = this.entries.get(guestId)
    if (existing && existing.status !== 'unavailable') return
    const entry: Entry = {
      status: 'connecting',
      listening: existing?.listening ?? true,
      track: null,
      whip: null,
      whep: null,
      audio: null,
    }
    this.entries.set(guestId, entry)
    this.emit()
    const stale = () => this.entries.get(guestId) !== entry

    try {
      const stream = await this.waitForMic()
      if (stale()) return
      const source = stream.getAudioTracks()[0]
      if (!source) throw new Error('Microphone has no audio track')
      const iceServers = await this.getIceServers().catch(() => [] as RTCIceServer[])
      if (stale()) return

      const clone = source.clone()
      clone.enabled = false
      entry.track = clone

      const onState = (state: RTCPeerConnectionState) => {
        if (state === 'failed' && !stale()) this.fail(guestId, entry, 'Connection failed')
      }
      const [whep, whip] = await Promise.allSettled([
        this.connect({
          kind: 'whep',
          productionId: this.productionId,
          guestId,
          iceServers,
          onConnectionState: onState,
          onTrack: (_track, remote) => {
            if (!stale() && entry.status !== 'unavailable') this.attachAudio(entry, remote)
          },
        }),
        this.connect({
          kind: 'whip',
          productionId: this.productionId,
          guestId,
          track: clone,
          iceServers,
          onConnectionState: onState,
        }),
      ])
      if (whep.status === 'fulfilled') entry.whep = whep.value
      if (whip.status === 'fulfilled') entry.whip = whip.value
      if (stale() || entry.status !== 'connecting') {
        // Closed (guest left, Close talkback, unmount) or failed (PC `failed`
        // on the leg that answered first) while the other leg was connecting.
        void this.releaseEntry(entry)
        return
      }
      const rejected = [whep, whip].find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (rejected) {
        this.fail(guestId, entry, failureMessage(rejected.reason))
        return
      }
      entry.status = 'open'
      this.applyEnabled()
      this.emit()
    } catch (err) {
      if (stale()) {
        void this.releaseEntry(entry)
        return
      }
      this.fail(guestId, entry, failureMessage(err))
    }
  }

  private attachAudio(entry: Entry, remote: MediaStream): void {
    if (!entry.audio) {
      entry.audio = this.createAudio()
      entry.audio.autoplay = true
      this.applySink(entry.audio)
    }
    entry.audio.muted = !entry.listening
    if (entry.audio.srcObject !== remote) entry.audio.srcObject = remote
    try {
      // Autoplay is allowed: Open talkback is a user gesture. Some engines
      // (and jsdom) return no promise, hence the defensive chaining.
      const playing = entry.audio.play() as Promise<void> | undefined
      playing?.catch(() => {})
    } catch { /* media element without playback support */ }
  }

  /** Mark a guest unavailable and tear its sessions down; keeps the row's error visible. */
  private fail(guestId: string, entry: Entry, error: string): void {
    void this.releaseEntry(entry)
    entry.status = 'unavailable'
    entry.error = error
    this.talk = talkReducer(this.talk, { type: 'remove', guestId })
    this.applyEnabled()
    this.emit()
  }

  /** Close both PCs, DELETE both crew sessions, stop the clone and the audio. */
  private releaseEntry(entry: Entry): Promise<number[]> {
    const sessions = [entry.whep, entry.whip].filter((s): s is TalkbackSession => s !== null)
    entry.whep = null
    entry.whip = null
    entry.track?.stop()
    entry.track = null
    if (entry.audio) {
      entry.audio.pause()
      entry.audio.srcObject = null
      entry.audio = null
    }
    return Promise.all(sessions.map((s) => s.close()))
  }

  /**
   * Close a guest's talkback ("Close talkback", `GUEST_STATE` left). Resolves
   * with the crew DELETE statuses once they complete.
   */
  close(guestId: string): Promise<number[]> {
    const entry = this.entries.get(guestId)
    if (!entry) return Promise.resolve([])
    this.entries.delete(guestId)
    this.talk = talkReducer(this.talk, { type: 'remove', guestId })
    const done = this.releaseEntry(entry)
    this.applyEnabled()
    this.emit()
    return done
  }

  /** Close every guest's talkback (production inactive, panel unmount). */
  closeAll(): Promise<number[]> {
    this.rejectMicWaiters('Talkback closed')
    return Promise.all(this.guestIds().map((id) => this.close(id))).then((r) => r.flat())
  }

  /** Close talkback for any guest no longer in `liveGuestIds` (a `GUEST_STATE` left removed them). */
  retainOnly(liveGuestIds: Iterable<string>): void {
    const live = new Set(liveGuestIds)
    for (const id of this.guestIds()) if (!live.has(id)) void this.close(id)
  }

  // ── Talk / listen ──────────────────────────────────────────────────────────

  dispatchTalk(action: TalkAction): void {
    const next = talkReducer(this.talk, action)
    if (next === this.talk) return
    this.talk = next
    this.applyEnabled()
    this.emit()
  }

  press(guestId: string): void { this.dispatchTalk({ type: 'press', guestId }) }
  release(guestId: string): void { this.dispatchTalk({ type: 'release', guestId }) }
  cancelHold(): void { this.dispatchTalk({ type: 'cancel-hold' }) }
  toggleLatch(guestId: string): void { this.dispatchTalk({ type: 'toggle-latch', guestId }) }

  setListening(guestId: string, listening: boolean): void {
    const entry = this.entries.get(guestId)
    if (!entry || entry.listening === listening) return
    entry.listening = listening
    if (entry.audio) entry.audio.muted = !listening
    this.emit()
  }

  /** Map the talk state onto every open guest's mic clone. */
  private applyEnabled(): void {
    for (const [guestId, e] of this.entries) {
      if (e.track) e.track.enabled = e.status === 'open' && isTalking(this.talk, guestId)
    }
  }
}
