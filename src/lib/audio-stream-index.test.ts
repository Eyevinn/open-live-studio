import { describe, expect, it } from 'vitest'
import { decideAudioStreamIndex } from './audio-stream-index'

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
