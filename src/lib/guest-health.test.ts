import { describe, it, expect } from 'vitest'
import { parseGuestHealth, guestHealthProblem } from './guest-health'

describe('parseGuestHealth', () => {
  it('parses a failed seat with the current Strom fields (no cause)', () => {
    expect(parseGuestHealth({ type: 'GUEST_HEALTH', mixerInput: 'video_in_15', blockId: 'b-input-15-x', status: 'failed', detail: 'audio branch stopped' }))
      .toEqual({ mixerInput: 'video_in_15', failure: { detail: 'audio branch stopped' } })
  })

  it('reads the media from whip_medium causes', () => {
    expect(parseGuestHealth({
      mixerInput: 'video_in_15',
      status: 'failed',
      causes: [
        { kind: 'whip_medium', slot: 0, medium: 'video', fault: 'never_sent' },
        { kind: 'whip_medium', slot: 1, medium: 'audio', fault: 'publisher_stopped' },
        { kind: 'whip_medium', slot: 2, medium: 'audio', fault: 'not_produced' },
      ],
    })).toEqual({ mixerInput: 'video_in_15', failure: { media: ['audio', 'video'] } })
  })

  it('skips cause kinds and media it does not know', () => {
    expect(parseGuestHealth({
      mixerInput: 'video_in_15',
      status: 'failed',
      causes: [{ kind: 'pad_stalled', medium: 'audio' }, { kind: 'whip_medium', medium: 'data' }, null, 'x'],
    })).toEqual({ mixerInput: 'video_in_15', failure: {} })
  })

  it('parses ok as a cleared seat', () => {
    expect(parseGuestHealth({ mixerInput: 'video_in_15', status: 'ok' })).toEqual({ mixerInput: 'video_in_15', failure: null })
  })

  it('rejects malformed frames', () => {
    expect(parseGuestHealth({ status: 'failed' })).toBeNull()
    expect(parseGuestHealth({ mixerInput: 'video_in_15', status: 'broken' })).toBeNull()
  })
})

describe('guestHealthProblem', () => {
  it('names the medium when known, otherwise says the input stopped', () => {
    expect(guestHealthProblem({ media: ['audio'] })).toBe('no audio')
    expect(guestHealthProblem({ media: ['video'] })).toBe('no video')
    expect(guestHealthProblem({ media: ['audio', 'video'] })).toBe('no audio or video')
    expect(guestHealthProblem({ detail: 'x' })).toBe('input stopped')
  })
})
