import { describe, it, expect, beforeEach } from 'vitest'
import { useGuestsStore } from './guests.store'

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
