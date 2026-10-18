import { describe, it, expect, beforeEach } from 'vitest'
import { useGuestsStore } from './guests.store'
import type { GuestInvite, GuestSession } from '@/lib/api'

describe('guests store health', () => {
  beforeEach(() => useGuestsStore.getState().reset())

  it('holds a seat while failed and drops it on ok', () => {
    const { applyGuestHealth } = useGuestsStore.getState()
    applyGuestHealth('video_in_15', { media: ['audio'], detail: 'no audio for 6 s' })
    applyGuestHealth('video_in_14', { detail: 'stalled' })
    expect(useGuestsStore.getState().health).toEqual({
      video_in_15: { media: ['audio'], detail: 'no audio for 6 s' },
      video_in_14: { detail: 'stalled' },
    })
    applyGuestHealth('video_in_15', null)
    expect(useGuestsStore.getState().health).toEqual({ video_in_14: { detail: 'stalled' } })
  })

  it('clearGuestHealth and reset empty it', () => {
    const s = useGuestsStore.getState()
    s.applyGuestHealth('video_in_15', {})
    s.clearGuestHealth()
    expect(useGuestsStore.getState().health).toEqual({})
    s.applyGuestHealth('video_in_15', {})
    s.reset()
    expect(useGuestsStore.getState().health).toEqual({})
  })
})

// studio#221: after a Studio reload the WS connect-sync GUEST_STATE (which
// carries the invite `label`) and the REST `GET .../guests` seed (which does
// not) race. Whichever lands last, the guest must keep its name.
describe('guests store name after reload', () => {
  beforeEach(() => useGuestsStore.getState().reset())

  const session = (over: Partial<GuestSession> = {}): GuestSession => ({
    id: 'g1',
    productionId: 'p1',
    inviteId: 'inv1',
    mixerInput: 'video_in_15',
    state: 'on-air',
    muted: false,
    ...over,
  })

  const invite = (over: Partial<GuestInvite> = {}): GuestInvite => ({
    id: 'inv1',
    productionId: 'p1',
    label: 'Alice',
    mixerInput: 'video_in_15',
    expiresAt: '2099-01-01T00:00:00Z',
    ...over,
  })

  it('keeps the WS label when the REST seed lands after GUEST_STATE', () => {
    const s = useGuestsStore.getState()
    s.applyGuestState({ guestId: 'g1', mixerInput: 'video_in_15', state: 'on-air', label: 'Alice', intercomLine: 'line-1', inviteId: 'inv1', muted: false })
    s.setGuests([session({ muted: true })])
    expect(useGuestsStore.getState().guests.g1).toEqual({
      guestId: 'g1',
      mixerInput: 'video_in_15',
      state: 'on-air',
      inviteId: 'inv1',
      muted: true,
      label: 'Alice',
      intercomLine: 'line-1',
    })
  })

  it('takes the WS label when GUEST_STATE lands after the REST seed', () => {
    const s = useGuestsStore.getState()
    s.setGuests([session()])
    expect(useGuestsStore.getState().guests.g1?.label).toBeUndefined()
    s.applyGuestState({ guestId: 'g1', mixerInput: 'video_in_15', state: 'on-air', label: 'Alice', muted: false })
    expect(useGuestsStore.getState().guests.g1?.label).toBe('Alice')
  })

  it('keeps each name with two guests', () => {
    const s = useGuestsStore.getState()
    s.applyGuestState({ guestId: 'g1', mixerInput: 'video_in_15', state: 'on-air', label: 'Alice', muted: false })
    s.applyGuestState({ guestId: 'g2', mixerInput: 'video_in_14', state: 'joined', label: 'Bob', muted: false })
    s.setGuests([session(), session({ id: 'g2', inviteId: 'inv2', mixerInput: 'video_in_14', state: 'joined' })])
    const { guests } = useGuestsStore.getState()
    expect(guests.g1?.label).toBe('Alice')
    expect(guests.g2?.label).toBe('Bob')
    expect(guests.g1?.mixerInput).toBe('video_in_15')
    expect(guests.g2?.mixerInput).toBe('video_in_14')
  })

  it('falls back to the invite label when no WS label is known', () => {
    const s = useGuestsStore.getState()
    s.setInvites([invite()])
    s.setGuests([session()])
    expect(useGuestsStore.getState().guests.g1?.label).toBe('Alice')
  })

  it('backfills the invite label when invites land after the REST seed', () => {
    const s = useGuestsStore.getState()
    s.setGuests([session(), session({ id: 'g2', inviteId: 'inv2', mixerInput: 'video_in_14' })])
    s.setInvites([invite(), invite({ id: 'inv2', label: 'Bob', mixerInput: 'video_in_14' })])
    const { guests } = useGuestsStore.getState()
    expect(guests.g1?.label).toBe('Alice')
    expect(guests.g2?.label).toBe('Bob')
  })

  it('does not overwrite a known label with the invite label', () => {
    const s = useGuestsStore.getState()
    s.applyGuestState({ guestId: 'g1', mixerInput: 'video_in_15', state: 'on-air', label: 'Alice (WS)', muted: false })
    s.setInvites([invite({ label: 'Alice (invite)' })])
    s.setGuests([session()])
    expect(useGuestsStore.getState().guests.g1?.label).toBe('Alice (WS)')
  })
})
