// @vitest-environment jsdom
/**
 * Operator talkback in the Guests panel (studio#237, OLS-A):
 * controls only with an `intercomLine`, teardown on `GUEST_STATE` left
 * (both crew DELETEs + both PCs closed), blur releases a held Talk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useGuestsStore, type GuestView } from '@/store/guests.store'
import { useIntercomStore } from '@/store/intercom.store'
import type { Production } from '@/store/productions.store'
import { FakePeerConnection, FakeStream, FakeTrack, makeTalkbackFetch, type FetchCall } from '@/lib/talkback.test-helpers'
import { GuestPanel } from './GuestPanel'

vi.mock('@/lib/sat', () => ({
  authenticateWithOpenLive: vi.fn(async () => 0),
  getApiToken: vi.fn(async () => 'crew-token'),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    guestsApi: {
      ...actual.guestsApi,
      listInvites: vi.fn(async () => []),
      listGuests: vi.fn(async () => []),
      kickGuest: vi.fn(async () => undefined),
    },
  }
})

function production(overrides: Partial<Production> = {}): Production {
  return {
    id: 'p1',
    name: 'Show',
    status: 'active',
    sources: [{ sourceId: 'Whip', mixerInput: 'video_in_15', returnFeed: { synced: 'program' } }],
    graphicAssignments: [],
    outputAssignments: [],
    ...overrides,
  } as Production
}

const guest = (overrides: Partial<GuestView> = {}): GuestView => ({
  guestId: 'g1',
  mixerInput: 'video_in_15',
  state: 'joined',
  label: 'Ana',
  intercomLine: '7',
  muted: false,
  ...overrides,
})

let calls: FetchCall[]
let micTrack: FakeTrack

beforeEach(() => {
  FakePeerConnection.instances = []
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
  const f = makeTalkbackFetch()
  calls = f.calls
  vi.stubGlobal('fetch', f.fetch)
  micTrack = new FakeTrack('mic')
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => new FakeStream([micTrack])),
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  useGuestsStore.getState().reset()
  useIntercomStore.setState({ micActive: false, localStream: null, micDeviceId: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Render, then let the REST seed (mocked to `[]`) land so it cannot wipe a seeded guest. */
async function renderPanel(p: Production = production()) {
  const utils = render(<GuestPanel production={p} send={() => {}} />)
  await act(async () => {})
  return utils
}

function seedGuest(g: GuestView) {
  act(() => { useGuestsStore.getState().applyGuestState(g) })
}

const talkbackCalls = () => calls.filter((c) => c.url.includes('/talkback/'))

async function openTalkback() {
  fireEvent.click(screen.getByRole('button', { name: /Open talkback to Ana/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Talk to Ana (hold)' })).toHaveProperty('disabled', false))
}

describe('GuestPanel operator talkback', () => {
  it('hides the talkback controls when the guest has no intercomLine', async () => {
    await renderPanel()
    seedGuest(guest({ intercomLine: undefined }))
    expect(screen.getByText('Ana')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /talkback/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Talk to/ })).toBeNull()
    expect(screen.queryByLabelText('Talkback microphone')).toBeNull()
  })

  it('shows the Talkback control and mic picker when intercomLine is set', async () => {
    await renderPanel()
    seedGuest(guest())
    expect(screen.getByRole('button', { name: /Open talkback to Ana/ })).toBeTruthy()
    expect(screen.getByLabelText('Talkback microphone')).toBeTruthy()
  })

  it('Open talkback acquires the mic and connects WHEP + WHIP with the crew token', async () => {
    await renderPanel()
    seedGuest(guest())
    await openTalkback()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ echoCancellation: true }),
    })
    const posts = talkbackCalls().filter((c) => c.method === 'POST').map((c) => new URL(c.url).pathname).sort()
    expect(posts).toEqual([
      '/api/v1/productions/p1/guests/g1/talkback/whep',
      '/api/v1/productions/p1/guests/g1/talkback/whip',
    ])
    expect(talkbackCalls().every((c) => c.headers['Authorization'] === 'Bearer crew-token')).toBe(true)
  })

  it('tears down on GUEST_STATE left: both DELETEs issued, both PCs closed, mic released', async () => {
    await renderPanel()
    seedGuest(guest())
    await openTalkback()
    expect(FakePeerConnection.instances).toHaveLength(2)

    seedGuest(guest({ state: 'left' }))

    await waitFor(() => expect(talkbackCalls().filter((c) => c.method === 'DELETE')).toHaveLength(2))
    const deletes = talkbackCalls().filter((c) => c.method === 'DELETE').map((c) => new URL(c.url).pathname).sort()
    expect(deletes[0]).toMatch(/^\/api\/v1\/productions\/p1\/guests\/g1\/talkback\/whep\/[0-9a-f-]{36}$/)
    expect(deletes[1]).toMatch(/^\/api\/v1\/productions\/p1\/guests\/g1\/talkback\/whip\/[0-9a-f-]{36}$/)
    expect(FakePeerConnection.instances.every((pc) => pc.closed)).toBe(true)
    await waitFor(() => expect(useIntercomStore.getState().micActive).toBe(false))
  })

  it('tears down when the production goes inactive', async () => {
    const { rerender } = await renderPanel()
    seedGuest(guest())
    await openTalkback()
    rerender(<GuestPanel production={production({ status: 'inactive' })} send={() => {}} />)
    await waitFor(() => expect(talkbackCalls().filter((c) => c.method === 'DELETE')).toHaveLength(2))
    expect(FakePeerConnection.instances.every((pc) => pc.closed)).toBe(true)
  })

  it('tears down on unmount', async () => {
    const { unmount } = await renderPanel()
    seedGuest(guest())
    await openTalkback()
    unmount()
    await waitFor(() => expect(talkbackCalls().filter((c) => c.method === 'DELETE')).toHaveLength(2))
    expect(FakePeerConnection.instances.every((pc) => pc.closed)).toBe(true)
  })

  it('hold Talk enables the guest track; window blur and visibility-hidden release it', async () => {
    await renderPanel()
    seedGuest(guest())
    await openTalkback()
    const whipPc = FakePeerConnection.instances.find((pc) => pc.transceivers[0]?.direction === 'sendonly')!
    const sent = () => whipPc.transceivers[0]!.sender.track!
    const talk = screen.getByRole('button', { name: 'Talk to Ana (hold)' })
    expect(sent().enabled).toBe(false)

    fireEvent.pointerDown(talk, { button: 0, pointerId: 1 })
    expect(sent().enabled).toBe(true)
    fireEvent.pointerUp(talk, { button: 0, pointerId: 1 })
    expect(sent().enabled).toBe(false)

    fireEvent.pointerDown(talk, { button: 0, pointerId: 1 })
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(sent().enabled).toBe(false)

    fireEvent.pointerDown(talk, { button: 0, pointerId: 1 })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(sent().enabled).toBe(false)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })

    fireEvent.pointerDown(talk, { button: 0, pointerId: 1 })
    fireEvent.pointerCancel(talk, { pointerId: 1 })
    expect(sent().enabled).toBe(false)
  })

  it('a 404 shows "Talkback unavailable" on that guest row only', async () => {
    vi.stubGlobal('fetch', makeTalkbackFetch((c) =>
      c.method === 'POST' && c.url.includes('/talkback/')
        ? new Response(JSON.stringify({ error: 'Talkback unavailable', statusCode: 404 }), { status: 404 })
        : undefined,
    ).fetch)
    await renderPanel()
    seedGuest(guest())
    fireEvent.click(screen.getByRole('button', { name: /Open talkback to Ana/ }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Talkback unavailable'))
    expect(FakePeerConnection.instances.every((pc) => pc.closed)).toBe(true)
    await waitFor(() => expect(useIntercomStore.getState().micActive).toBe(false))
  })
})
