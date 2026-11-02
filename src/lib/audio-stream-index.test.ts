import { describe, expect, it } from 'vitest'
import { audioStreamIndexPatch, decideAudioStreamIndex, supportsAudioStreamSelection } from './audio-stream-index'

describe('decideAudioStreamIndex', () => {
  it('does not send an empty string', () => {
    expect(decideAudioStreamIndex('', '0')).toEqual({ send: false })
  })

  it('does not send a negative index', () => {
    expect(decideAudioStreamIndex('-1', '0')).toEqual({ send: false })
  })

  it('does not send a non-integer index', () => {
    expect(decideAudioStreamIndex('1.5', '0')).toEqual({ send: false })
  })

  it('does not send a non-numeric value', () => {
    expect(decideAudioStreamIndex('abc', '0')).toEqual({ send: false })
  })

  it('does not send when the value is unchanged', () => {
    expect(decideAudioStreamIndex('2', '2')).toEqual({ send: false })
  })

  it('sends the parsed index when changed to a valid value', () => {
    expect(decideAudioStreamIndex('3', '0')).toEqual({ send: true, audioStreamIndex: 3 })
  })

  it('sends 0 when the value changed to 0', () => {
    expect(decideAudioStreamIndex('0', '2')).toEqual({ send: true, audioStreamIndex: 0 })
  })
})

describe('supportsAudioStreamSelection (OL-45)', () => {
  it('is true for MPEG-TS/SRT only', () => {
    expect(supportsAudioStreamSelection('srt')).toBe(true)
    for (const t of ['efp', 'whip', 'test1', 'test2', 'html', 'clip'] as const) {
      expect(supportsAudioStreamSelection(t)).toBe(false)
    }
  })
})

describe('audioStreamIndexPatch (OL-45)', () => {
  it('sends a changed index for SRT', () => {
    expect(audioStreamIndexPatch('srt', '2', '0')).toEqual({ audioStreamIndex: 2 })
  })

  it('sends nothing for an unchanged SRT index', () => {
    expect(audioStreamIndexPatch('srt', '2', '2')).toEqual({})
  })

  it('never sends a chosen index for EFP', () => {
    expect(audioStreamIndexPatch('efp', '3', '0')).toEqual({})
  })

  it('clears a stale stored EFP index to 0', () => {
    expect(audioStreamIndexPatch('efp', '2', '2')).toEqual({ audioStreamIndex: 0 })
  })

  it('sends nothing for other source types', () => {
    expect(audioStreamIndexPatch('html', '2', '0')).toEqual({})
  })
})
