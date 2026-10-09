import { describe, it, expect } from 'vitest'
import { compareMixerInput } from './mixer-input-order'

describe('compareMixerInput', () => {
  it('orders numerically, not as text', () => {
    const sorted = ['video_in_15', 'video_in_10', 'video_in_2', 'video_in_0'].sort(compareMixerInput)
    expect(sorted).toEqual(['video_in_0', 'video_in_2', 'video_in_10', 'video_in_15'])
  })

  it('sorts names without a numeric suffix after numbered ones, deterministically', () => {
    const sorted = ['zeta', 'video_in_1', 'alpha'].sort(compareMixerInput)
    expect(sorted).toEqual(['video_in_1', 'alpha', 'zeta'])
  })
})
