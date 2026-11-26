import { describe, it, expect } from 'vitest'
import { guestSlotName, guestSlotNumber } from './guest-slots'

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

// Spec test plan 1-3 (open-live docs/specs/guest-slot-input-numbering.md,
// studio#262): the shared tile name of a guest slot.
describe('guestSlotName', () => {
  const assignments = [
    { sourceId: 'cam-1', mixerInput: 'video_in_0' },
    { sourceId: 'Whip', mixerInput: 'video_in_3' },
    { sourceId: 'Whip', mixerInput: 'video_in_14', returnFeed: { synced: 'program-minus' } },
    { sourceId: 'Whip', mixerInput: 'video_in_15', returnFeed: { synced: 'program-minus' } },
  ]

  it('names a guest slot with no guest joined "Guest N"', () => {
    expect(guestSlotName(assignments, 'video_in_15', [])).toBe('Guest 1')
    expect(guestSlotName(assignments, 'video_in_14', [])).toBe('Guest 2')
  })

  it("names a guest slot with a joined guest by the guest's invite label", () => {
    const guests = [
      { mixerInput: 'video_in_15', label: 'Anna' },
      { mixerInput: 'video_in_14', label: '  Bo · In 15  ' },
    ]
    expect(guestSlotName(assignments, 'video_in_15', guests)).toBe('Anna')
    expect(guestSlotName(assignments, 'video_in_14', guests)).toBe('Bo · In 15')
  })

  it('falls back to "Guest N" for a joined guest with no usable label', () => {
    expect(guestSlotName(assignments, 'video_in_15', [{ mixerInput: 'video_in_15' }])).toBe('Guest 1')
    expect(guestSlotName(assignments, 'video_in_14', [{ mixerInput: 'video_in_14', label: '  ' }])).toBe('Guest 2')
  })

  it('is undefined for a non-guest input, including a manual WHIP source without returnFeed', () => {
    const guests = [{ mixerInput: 'video_in_3', label: 'Stray' }]
    expect(guestSlotName(assignments, 'video_in_3', guests)).toBeUndefined()
    expect(guestSlotName(assignments, 'video_in_0', [])).toBeUndefined()
    expect(guestSlotName(assignments, 'video_in_7', [])).toBeUndefined()
  })
})
