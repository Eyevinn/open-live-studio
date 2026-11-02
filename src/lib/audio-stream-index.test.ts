import { describe, expect, it } from 'vitest'
import {
  NEW_AUDIO_STREAM_INDEX_ERROR,
  audioStreamIndexPatch,
  decideAudioStreamIndex,
  newSourceAudioStreamIndex,
  supportsAudioStreamSelection,
} from './audio-stream-index'

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

describe('newSourceAudioStreamIndex (studio#244)', () => {
  it('sends an index > 0 for SRT', () => {
    expect(newSourceAudioStreamIndex('srt', '2')).toEqual({ ok: true, body: { audioStreamIndex: 2 } })
  })

  it('trims surrounding whitespace', () => {
    expect(newSourceAudioStreamIndex('srt', ' 3 ')).toEqual({ ok: true, body: { audioStreamIndex: 3 } })
  })

  it('sends nothing for 0 (absent means 0)', () => {
    expect(newSourceAudioStreamIndex('srt', '0')).toEqual({ ok: true, body: {} })
  })

  it('sends nothing for an empty value', () => {
    expect(newSourceAudioStreamIndex('srt', '')).toEqual({ ok: true, body: {} })
    expect(newSourceAudioStreamIndex('srt', '   ')).toEqual({ ok: true, body: {} })
  })

  it('rejects a negative index', () => {
    expect(newSourceAudioStreamIndex('srt', '-1')).toEqual({ ok: false, error: NEW_AUDIO_STREAM_INDEX_ERROR })
  })

  it('rejects a non-integer index', () => {
    expect(newSourceAudioStreamIndex('srt', '1.5')).toEqual({ ok: false, error: NEW_AUDIO_STREAM_INDEX_ERROR })
  })

  it('rejects a non-numeric value', () => {
    expect(newSourceAudioStreamIndex('srt', 'abc')).toEqual({ ok: false, error: NEW_AUDIO_STREAM_INDEX_ERROR })
  })

  it('never sends an index for types without audio stream selection, whatever the input', () => {
    for (const t of ['efp', 'whip', 'test1', 'test2', 'html', 'clip'] as const) {
      expect(newSourceAudioStreamIndex(t, '2')).toEqual({ ok: true, body: {} })
      expect(newSourceAudioStreamIndex(t, '-1')).toEqual({ ok: true, body: {} })
    }
  })
})
