import { describe, expect, it } from 'vitest'
import {
  EQ_BAND_FIELDS,
  STAGE_FIELDS,
  buildProcSetMessage,
  clampToRange,
  completeStageParams,
  isStageActive,
  mergeStageParams,
  parseProcStateFrame,
  sliderToValue,
  stageAllowedOnElement,
  stagesForElement,
  validateStageParams,
  valueToSlider,
  SLIDER_STEPS,
} from './audio-processing'

// Contract: open-live src/lib/audio-processing.ts and docs/controller-websocket.md (OL-25).

describe('stage placement', () => {
  it('gain/hpf/gate are channel-only, comp/eq both, limiter main-only', () => {
    expect(stagesForElement('ch1')).toEqual(['gain', 'hpf', 'gate', 'comp', 'eq'])
    expect(stagesForElement('main')).toEqual(['comp', 'eq', 'limiter'])
    expect(stageAllowedOnElement('limiter', 'ch3')).toBe(false)
    expect(stageAllowedOnElement('gate', 'main')).toBe(false)
    expect(stageAllowedOnElement('comp', 'aux1')).toBe(false)
  })
})

describe('ranges', () => {
  it('mirror the server ranges exactly', () => {
    expect(STAGE_FIELDS.gain.gain).toMatchObject({ min: -20, max: 20 })
    expect(STAGE_FIELDS.hpf.freq).toMatchObject({ min: 20, max: 500 })
    expect(STAGE_FIELDS.gate.threshold).toMatchObject({ min: -60, max: 0 })
    expect(STAGE_FIELDS.gate.attack).toMatchObject({ min: 0.1, max: 200 })
    expect(STAGE_FIELDS.gate.release).toMatchObject({ min: 10, max: 1000 })
    expect(STAGE_FIELDS.comp.ratio).toMatchObject({ min: 1, max: 20 })
    expect(STAGE_FIELDS.comp.makeup).toMatchObject({ min: 0, max: 24 })
    expect(STAGE_FIELDS.comp.knee).toMatchObject({ min: -24, max: 0 })
    expect(STAGE_FIELDS.limiter.threshold).toMatchObject({ min: -20, max: 0 })
    expect(EQ_BAND_FIELDS.freq).toMatchObject({ min: 20, max: 20000 })
    expect(EQ_BAND_FIELDS.gain).toMatchObject({ min: -15, max: 15 })
    expect(EQ_BAND_FIELDS.q).toMatchObject({ min: 0.1, max: 10 })
  })

  it('clampToRange rounds to the step and clamps into the range', () => {
    const gain = STAGE_FIELDS.gain.gain!
    expect(clampToRange(25, gain)).toBe(20)
    expect(clampToRange(-21.3, gain)).toBe(-20)
    expect(clampToRange(3.14159, gain)).toBe(3.1)
    expect(clampToRange(Number.NaN, gain)).toBe(-20)
    expect(clampToRange(0.04, EQ_BAND_FIELDS.q)).toBe(0.1)
  })

  it('slider mapping stays inside the range at both ends, linear and log', () => {
    for (const range of [STAGE_FIELDS.gain.gain!, EQ_BAND_FIELDS.freq, STAGE_FIELDS.gate.attack!]) {
      expect(sliderToValue(0, range)).toBe(range.min)
      expect(sliderToValue(SLIDER_STEPS, range)).toBe(range.max)
      expect(sliderToValue(-50, range)).toBe(range.min)
      expect(sliderToValue(SLIDER_STEPS + 50, range)).toBe(range.max)
      expect(valueToSlider(range.max * 10, range)).toBe(SLIDER_STEPS)
    }
    // Log taper: the middle of a 20..20000 Hz slider is ~632 Hz, not ~10 kHz.
    expect(sliderToValue(SLIDER_STEPS / 2, EQ_BAND_FIELDS.freq)).toBe(632)
    expect(sliderToValue(valueToSlider(1000, EQ_BAND_FIELDS.freq), EQ_BAND_FIELDS.freq)).toBeCloseTo(1000, -1)
  })
})

describe('validateStageParams', () => {
  it('accepts partial in-range params', () => {
    expect(validateStageParams('comp', { threshold: -30 })).toBeNull()
    expect(validateStageParams('eq', { bands: [{ band: 2, gain: -3 }] })).toBeNull()
    expect(validateStageParams('hpf', { enabled: true })).toBeNull()
  })

  it('rejects out-of-range values, unknown keys and bad bands', () => {
    expect(validateStageParams('gain', { gain: 20.5 })).toMatch(/-20 to 20/)
    expect(validateStageParams('limiter', { threshold: -30 })).toMatch(/-20 to 0/)
    expect(validateStageParams('comp', { threshold: -30, ratio: 0.5 })).toMatch(/ratio/)
    expect(validateStageParams('eq', { bands: [{ band: 5, gain: 0 }] })).toMatch(/band/)
    expect(validateStageParams('eq', { bands: [{ band: 1, freq: 25000 }] })).toMatch(/freq/)
    expect(validateStageParams('gate', { ratio: 2 })).toMatch(/unknown key/)
    expect(validateStageParams('gain', { enabled: true, gain: 0 })).toMatch(/unknown key/)
    expect(validateStageParams('gain', {})).toMatch(/required/)
  })
})

describe('buildProcSetMessage', () => {
  it('builds the AUDIO_PROC_SET frame with the contract field names', () => {
    const r = buildProcSetMessage('ch1', 'comp', { enabled: true, threshold: -40, ratio: 10 }, 'c1')
    expect(r).toEqual({
      ok: true,
      msg: { type: 'AUDIO_PROC_SET', elementId: 'ch1', stage: 'comp', params: { enabled: true, threshold: -40, ratio: 10 }, cmdId: 'c1' },
    })
  })

  it('refuses out-of-range values and misplaced stages, so they can never be sent', () => {
    expect(buildProcSetMessage('ch1', 'gain', { gain: 99 }).ok).toBe(false)
    expect(buildProcSetMessage('ch1', 'limiter', { enabled: true }).ok).toBe(false)
    expect(buildProcSetMessage('main', 'hpf', { freq: 100 }).ok).toBe(false)
  })
})

describe('merge and parse', () => {
  it('merges EQ bands per band number', () => {
    const merged = mergeStageParams(
      { enabled: true, bands: [{ band: 1, freq: 80, gain: 0, q: 1 }, { band: 2, freq: 400, gain: 0, q: 1 }] },
      { bands: [{ band: 2, gain: -6 }] },
    )
    expect(merged).toEqual({ enabled: true, bands: [{ band: 1, freq: 80, gain: 0, q: 1 }, { band: 2, freq: 400, gain: -6, q: 1 }] })
  })

  it('completes partial params from the Strom defaults', () => {
    expect(completeStageParams('comp', { threshold: -10 })).toEqual({
      enabled: false, threshold: -10, ratio: 4, attack: 10, release: 100, makeup: 0, knee: -6,
    })
    expect(completeStageParams('eq', undefined).bands).toHaveLength(4)
  })

  it('isStageActive uses enabled, or a non-zero input gain', () => {
    expect(isStageActive('gain', { gain: 0 })).toBe(false)
    expect(isStageActive('gain', { gain: 3 })).toBe(true)
    expect(isStageActive('comp', { enabled: true })).toBe(true)
  })

  it('parses AUDIO_PROC_STATE, dropping unknown keys and malformed frames', () => {
    expect(parseProcStateFrame({
      type: 'AUDIO_PROC_STATE', elementId: 'main', stage: 'limiter', params: { enabled: true, threshold: -1, bogus: 1 }, applied: true,
    })).toEqual({ elementId: 'main', stage: 'limiter', params: { enabled: true, threshold: -1 }, applied: true })
    expect(parseProcStateFrame({ type: 'AUDIO_PROC_STATE', elementId: 'ch1', stage: 'comp', params: {} })?.applied).toBe(false)
    expect(parseProcStateFrame({ type: 'AUDIO_PROC_STATE', elementId: 'ch1', stage: 'limiter', params: {} })).toBeNull()
    expect(parseProcStateFrame({ type: 'AUDIO_PROC_STATE', elementId: 'ch1', stage: 'reverb', params: {} })).toBeNull()
  })
})
