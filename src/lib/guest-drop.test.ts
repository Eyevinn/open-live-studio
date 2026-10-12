import { describe, it, expect } from 'vitest'
import { liveDroppedMixerInputs, droppedPipIndices } from './guest-drop'
import type { DroppedGuest } from '@/store/guests.store'
import type { PipConfig, PipZone } from '@/store/production.store'

const dropped = (...mixerInputs: string[]): Record<string, DroppedGuest> =>
  Object.fromEntries(mixerInputs.map((mi) => [mi, { mixerInput: mi, at: 0 }]))

const zone = (sources: number[]): PipZone => ({ rect: null, capacity: null, sources })
const pip = (...zones: PipZone[]): PipConfig => ({ bg: null, zones, transforms: {} })

describe('liveDroppedMixerInputs', () => {
  it('is empty when nothing dropped', () => {
    expect(liveDroppedMixerInputs({}, { pgmInput: 'video_in_0', pgmPip: null, pips: [] }).size).toBe(0)
  })

  it('flags a dropped input taken directly to program', () => {
    const live = liveDroppedMixerInputs(dropped('video_in_15'), {
      pgmInput: 'video_in_15',
      pgmPip: null,
      pips: [],
    })
    expect([...live]).toEqual(['video_in_15'])
  })

  it('stays silent for a dropped input that is not live', () => {
    const live = liveDroppedMixerInputs(dropped('video_in_15'), {
      pgmInput: 'video_in_0',
      pgmPip: null,
      pips: [],
    })
    expect(live.size).toBe(0)
  })

  it('flags a dropped input that is a source of the program PiP', () => {
    const live = liveDroppedMixerInputs(dropped('video_in_15'), {
      pgmInput: 'video_in_0',
      pgmPip: 1,
      pips: [pip(zone([2])), pip(zone([15, 3]))],
    })
    expect([...live]).toEqual(['video_in_15'])
  })

  it('does not flag a dropped input in a PiP that is not on program', () => {
    const live = liveDroppedMixerInputs(dropped('video_in_15'), {
      pgmInput: 'video_in_0',
      pgmPip: 0,
      pips: [pip(zone([2])), pip(zone([15]))],
    })
    expect(live.size).toBe(0)
  })
})

describe('droppedPipIndices', () => {
  it('returns indices of PiPs containing a dropped input (live or queued)', () => {
    const pips = [pip(zone([0, 1])), pip(zone([15]))]
    expect([...droppedPipIndices(pips, dropped('video_in_15'))]).toEqual([1])
  })

  it('is empty when no PiP references a dropped input', () => {
    const pips = [pip(zone([0, 1]))]
    expect(droppedPipIndices(pips, dropped('video_in_15')).size).toBe(0)
  })

  it('is empty when there are no drops', () => {
    expect(droppedPipIndices([pip(zone([0]))], {}).size).toBe(0)
  })
})
