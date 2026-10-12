import { describe, expect, it } from 'vitest'
import { resolveTallyState, type TallyBuses } from './tally'

const EMPTY: TallyBuses = { pgmInput: null, pvwInput: null, programInputs: [], previewInputs: [] }

describe('resolveTallyState', () => {
  it('returns off when the source is on no bus', () => {
    expect(resolveTallyState(['video_in_3'], EMPTY)).toBe('off')
  })

  it('lights pgm from the legacy single PGM slot (plain main source on program)', () => {
    expect(resolveTallyState(['video_in_1'], { ...EMPTY, pgmInput: 'video_in_1' })).toBe('pgm')
  })

  it('lights pvw from the legacy single PVW slot', () => {
    expect(resolveTallyState(['video_in_2'], { ...EMPTY, pvwInput: 'video_in_2' })).toBe('pvw')
  })

  // open-live#492: while a PiP occupies program the single pgmInput slot is null, so a
  // zone-inset source is only discoverable via the contribution-tally program array.
  it('lights pgm for a PiP zone-inset source when the single PGM slot is null', () => {
    const buses: TallyBuses = { ...EMPTY, pgmInput: null, programInputs: ['video_in_4', 'video_in_7'] }
    expect(resolveTallyState(['video_in_7'], buses)).toBe('pgm')
  })

  it('lights pvw for a zone-inset source via the preview contribution array', () => {
    expect(resolveTallyState(['video_in_5'], { ...EMPTY, previewInputs: ['video_in_5'] })).toBe('pvw')
  })

  it('prefers pgm over pvw when a source is on both buses', () => {
    const buses: TallyBuses = { ...EMPTY, programInputs: ['video_in_6'], previewInputs: ['video_in_6'] }
    expect(resolveTallyState(['video_in_6'], buses)).toBe('pgm')
  })

  it('matches when any of a multi-input source is on program', () => {
    const buses: TallyBuses = { ...EMPTY, programInputs: ['video_in_9'] }
    expect(resolveTallyState(['video_in_8', 'video_in_9'], buses)).toBe('pgm')
  })

  it('returns off for a source with no mixer inputs', () => {
    expect(resolveTallyState([], { ...EMPTY, programInputs: ['video_in_1'] })).toBe('off')
  })
})
