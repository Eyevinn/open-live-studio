import { describe, expect, it } from 'vitest'
import { audioStreamWarningsByInput, inputRecordingWarningsByInput, type ActivationWarning } from './activation-warnings'

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

describe('inputRecordingWarningsByInput (OL-32)', () => {
  const noOutput: ActivationWarning = {
    type: 'input-recording-no-output',
    mixerInputs: ['video_in_0', 'video_in_2'],
    message: 'Inputs are set to record but the production has no Recording output.',
  }
  const unsupported: ActivationWarning = {
    type: 'input-recording-unsupported-source',
    mixerInput: 'video_in_3',
    sourceId: 'gfx',
    message: 'GFX is no longer a WHIP, SRT or EFP source; it is not recorded.',
  }

  it('maps each listed mixerInput, and the single-input variant', () => {
    const map = inputRecordingWarningsByInput({ status: 'active', activationWarnings: [noOutput, unsupported, noAudio] })
    expect([...map.keys()].sort()).toEqual(['video_in_0', 'video_in_2', 'video_in_3'])
    expect(map.get('video_in_0')).toEqual([noOutput.message])
    expect(map.get('video_in_3')).toEqual([unsupported.message])
  })

  it('covers the unavailable and capped variants', () => {
    const map = inputRecordingWarningsByInput({
      status: 'active',
      activationWarnings: [
        { type: 'input-recording-unavailable', mixerInputs: ['video_in_1'], message: 'No Live Recorder.' },
        { type: 'input-recording-capped', mixerInputs: ['video_in_5'], message: 'Over the cap.' },
      ],
    })
    expect(map.get('video_in_1')).toEqual(['No Live Recorder.'])
    expect(map.get('video_in_5')).toEqual(['Over the cap.'])
  })

  it('ignores audio warnings, malformed items and inactive productions', () => {
    const malformed = { type: 'input-recording-no-output', mixerInputs: 'video_in_0', message: 'x' } as unknown as ActivationWarning
    expect(inputRecordingWarningsByInput({ status: 'active', activationWarnings: [audioWarning('video_in_0'), malformed] }).size).toBe(0)
    expect(inputRecordingWarningsByInput({ status: 'inactive', activationWarnings: [noOutput] }).size).toBe(0)
  })
})
