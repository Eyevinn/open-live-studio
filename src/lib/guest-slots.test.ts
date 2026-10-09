import { describe, it, expect } from 'vitest'
import { guestSlotNumber } from './guest-slots'

describe('guestSlotNumber', () => {
  const sources = [
    { mixerInput: 'video_in_0' },
    { mixerInput: 'video_in_14', returnFeed: { synced: 'program-minus' } },
    { mixerInput: 'video_in_15', returnFeed: { synced: 'program-minus' } },
    { mixerInput: 'video_in_9', returnFeed: { synced: 'program' } },
  ]

  it('numbers guest slots from the top of the mixer-input range down', () => {
    expect(guestSlotNumber(sources, 'video_in_15')).toBe(1)
    expect(guestSlotNumber(sources, 'video_in_14')).toBe(2)
    expect(guestSlotNumber(sources, 'video_in_9')).toBe(3)
  })

  it('is undefined for a non-guest input', () => {
    expect(guestSlotNumber(sources, 'video_in_0')).toBeUndefined()
    expect(guestSlotNumber(sources, 'video_in_3')).toBeUndefined()
  })
})
