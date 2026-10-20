import { describe, expect, it } from 'vitest'
import { audioStreamWarningsByInput, type ActivationWarning } from './activation-warnings'

const noAudio: ActivationWarning = {
  type: 'recording-no-audio',
  message: 'Recording "Rec" has no audio: no source carries audio.',
}

function audioWarning(mixerInput: string, overrides: Record<string, unknown> = {}): ActivationWarning {
  return {
    type: 'audio-stream-not-applied',
    sourceId: 'src-cam-1',
    mixerInput,
    requestedIndex: 1,
    appliedIndex: 0,
    reason: 'strom-capability-missing',
    message: 'Cam 1 (SRT): audio stream 2 was not applied, using stream 1. This Strom cannot select an audio stream by PID yet.',
    ...overrides,
  } as ActivationWarning
}

describe('audioStreamWarningsByInput', () => {
  it('flags only the input whose stored mixerInput matches the warning', () => {
    const map = audioStreamWarningsByInput({
      status: 'active',
      activationWarnings: [audioWarning('video_in_3')],
    })
    expect([...map.keys()]).toEqual(['video_in_3'])
    expect(map.get('video_in_3')).toEqual([audioWarning('video_in_3').message])
    expect(map.has('video_in_0')).toBe(false)
    expect(map.has('video_in_1')).toBe(false)
  })

  it('flags each input separately when one source is assigned to two inputs', () => {
    const map = audioStreamWarningsByInput({
      status: 'active',
      activationWarnings: [audioWarning('video_in_0'), audioWarning('video_in_2')],
    })
    expect([...map.keys()].sort()).toEqual(['video_in_0', 'video_in_2'])
  })

  it('never puts a recording-no-audio warning on an input tile', () => {
    const map = audioStreamWarningsByInput({ status: 'active', activationWarnings: [noAudio] })
    expect(map.size).toBe(0)
  })

  it('keeps both variants apart when mixed', () => {
    const map = audioStreamWarningsByInput({
      status: 'active',
      activationWarnings: [noAudio, audioWarning('video_in_1')],
    })
    expect([...map.keys()]).toEqual(['video_in_1'])
  })

  it('shows nothing once the production is no longer active', () => {
    for (const status of ['inactive', 'activating', 'ended']) {
      const map = audioStreamWarningsByInput({ status, activationWarnings: [audioWarning('video_in_3')] })
      expect(map.size).toBe(0)
    }
  })

  it('handles a missing production or missing warnings', () => {
    expect(audioStreamWarningsByInput(undefined).size).toBe(0)
    expect(audioStreamWarningsByInput({ status: 'active' }).size).toBe(0)
    expect(audioStreamWarningsByInput({ status: 'active', activationWarnings: [] }).size).toBe(0)
  })

  it('tolerates unknown extra fields and ignores unknown warning types', () => {
    const map = audioStreamWarningsByInput({
      status: 'active',
      activationWarnings: [
        audioWarning('video_in_4', { futureField: { nested: true } }),
        { type: 'some-future-warning', message: 'later', mixerInput: 'video_in_5' } as unknown as ActivationWarning,
        { type: 'audio-stream-not-applied', message: 'no input key' } as unknown as ActivationWarning,
      ],
    })
    expect([...map.keys()]).toEqual(['video_in_4'])
  })
})
