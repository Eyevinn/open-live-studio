import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { PENDING_TTL_MS, useAudioProcessingStore } from './audioProcessing.store'

const st = () => useAudioProcessingStore.getState()

describe('audio processing store', () => {
  beforeEach(() => st().reset('p1'))

  it('renders replay / broadcasts from another operator and treats them as confirmed', () => {
    st().applyState({ elementId: 'ch1', stage: 'comp', params: { enabled: true, threshold: -40 }, applied: false })
    expect(st().known.ch1?.comp).toEqual({ enabled: true, threshold: -40 })
    expect(st().confirmed.ch1?.comp).toEqual({ enabled: true, threshold: -40 })
  })

  it('NACK reverts the rejected keys to the last confirmed value and flags the control', () => {
    st().applyState({ elementId: 'ch1', stage: 'comp', params: { threshold: -30 }, applied: true })
    st().localEdit('ch1', 'comp', { threshold: -10, ratio: 6 })
    st().registerPending('c1', 'ch1', 'comp', { threshold: -10 })
    expect(st().nack('c1', 'Audio processing: Strom refused')).toBe(true)
    expect(st().known.ch1?.comp).toEqual({ threshold: -30, ratio: 6 })
    expect(st().errors['ch1:comp']).toEqual({ message: 'Audio processing: Strom refused', fields: ['threshold'] })
    expect(st().pending).toEqual({})
  })

  it('NACK on a never-confirmed key reverts to the Strom default', () => {
    st().localEdit('ch1', 'eq', { bands: [{ band: 3, gain: 9 }] })
    st().registerPending('c1', 'ch1', 'eq', { bands: [{ band: 3, gain: 9 }] })
    st().nack('c1', 'no')
    expect(st().known.ch1?.eq?.bands).toEqual([{ band: 3, gain: 0 }])
    expect(st().errors['ch1:eq']?.fields).toEqual(['bands.3.gain'])
  })

  it('an echo of an older frame does not pull back a key still in flight', () => {
    st().localEdit('ch1', 'gain', { gain: 6 })
    st().registerPending('c1', 'ch1', 'gain', { gain: 2 })
    st().registerPending('c2', 'ch1', 'gain', { gain: 6 })
    st().applyState({ elementId: 'ch1', stage: 'gain', params: { gain: 2 }, applied: false })
    expect(st().known.ch1?.gain).toEqual({ gain: 6 })
    // ACK of the newest folds every older command on the stage into confirmed.
    st().ack('c2')
    expect(st().pending).toEqual({})
    expect(st().confirmed.ch1?.gain).toEqual({ gain: 6 })
  })

  it('applied:true always updates confirmed', () => {
    st().registerPending('c1', 'main', 'limiter', { threshold: -2 })
    st().applyState({ elementId: 'main', stage: 'limiter', params: { threshold: -2 }, applied: true })
    expect(st().confirmed.main?.limiter).toEqual({ threshold: -2 })
  })

  it('ignores ACK/NACK for cmdIds it did not register', () => {
    expect(st().ack('nope')).toBe(false)
    expect(st().nack('nope', 'x')).toBe(false)
    expect(st().errors).toEqual({})
  })

  it('hydrate seeds stages, skips stages in flight and stale productions', () => {
    st().registerPending('c1', 'ch1', 'gate', { threshold: -20 })
    st().hydrate('p1', 'ch1', { gain: { gain: 4 }, gate: { enabled: false, threshold: -40 }, limiter: { enabled: true } })
    expect(st().known.ch1?.gain).toEqual({ gain: 4 })
    expect(st().known.ch1?.gate).toBeUndefined()
    expect(st().known.ch1?.limiter).toBeUndefined()
    st().hydrate('other', 'ch1', { gain: { gain: -4 } })
    expect(st().known.ch1?.gain).toEqual({ gain: 4 })
  })

  it('a local edit clears the stage error; reset clears everything', () => {
    st().setError('ch1', 'hpf', { message: 'bad', fields: ['freq'] })
    st().localEdit('ch1', 'hpf', { freq: 100 })
    expect(st().errors).toEqual({})
    st().reset('p2')
    expect(st()).toMatchObject({ productionId: 'p2', known: {}, confirmed: {}, pending: {}, errors: {} })
  })

  describe('pending expiry', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('forgets commands whose ACK never came', () => {
      st().registerPending('c1', 'ch1', 'gain', { gain: 1 })
      vi.advanceTimersByTime(PENDING_TTL_MS + 1)
      st().applyState({ elementId: 'ch1', stage: 'gain', params: { gain: 3 }, applied: false })
      expect(st().pending).toEqual({})
      expect(st().known.ch1?.gain).toEqual({ gain: 3 })
    })

    it('reconciles known to confirmed when a command superseded by another operator expires (review #232)', () => {
      st().localEdit('ch1', 'comp', { threshold: -30 })
      st().registerPending('A1', 'ch1', 'comp', { threshold: -30 })
      st().applyState({ elementId: 'ch1', stage: 'comp', params: { threshold: -30 }, applied: false }) // own echo
      st().applyState({ elementId: 'ch1', stage: 'comp', params: { threshold: -45 }, applied: false }) // B supersedes
      st().applyState({ elementId: 'ch1', stage: 'comp', params: { threshold: -45 }, applied: true })
      // A1 is still in flight: the local value stays on screen for now.
      expect(st().known.ch1?.comp).toEqual({ threshold: -30 })
      vi.advanceTimersByTime(PENDING_TTL_MS + 1000)
      st().applyState({ elementId: 'ch1', stage: 'comp', params: { ratio: 6 }, applied: true })
      expect(st().pending).toEqual({})
      expect(st().confirmed.ch1?.comp).toEqual({ threshold: -45, ratio: 6 })
      expect(st().known.ch1?.comp).toEqual({ threshold: -45, ratio: 6 })
      expect(st().known.ch1?.comp).toEqual(st().confirmed.ch1?.comp)
    })

    it('hydrate expires a superseded command with no trailing frame (review #232 C1)', () => {
      st().localEdit('ch1', 'comp', { threshold: -30 })
      st().registerPending('A1', 'ch1', 'comp', { threshold: -30 })
      st().applyState({ elementId: 'ch1', stage: 'comp', params: { threshold: -30 }, applied: false })
      st().applyState({ elementId: 'ch1', stage: 'comp', params: { threshold: -45 }, applied: false })
      st().applyState({ elementId: 'ch1', stage: 'comp', params: { threshold: -45 }, applied: true })
      vi.advanceTimersByTime(PENDING_TTL_MS + 1000)
      // Close and reopen FX: hydrate runs, no processing frame has arrived since.
      st().hydrate('p1', 'ch1', { comp: { threshold: -45 } })
      expect(st().pending).toEqual({})
      expect(st().confirmed.ch1?.comp).toEqual({ threshold: -45 })
      expect(st().known.ch1?.comp).toEqual({ threshold: -45 })
    })

    it('does not reconcile a key that a newer command still has in flight', () => {
      st().applyState({ elementId: 'ch1', stage: 'comp', params: { threshold: -20, ratio: 2 }, applied: true })
      st().localEdit('ch1', 'comp', { threshold: -30, ratio: 4 })
      st().registerPending('A1', 'ch1', 'comp', { threshold: -30, ratio: 4 })
      vi.advanceTimersByTime(PENDING_TTL_MS + 1)
      st().localEdit('ch1', 'comp', { threshold: -35 })
      st().registerPending('A2', 'ch1', 'comp', { threshold: -35 })
      // A1 expired: ratio has nothing newer in flight and goes back to confirmed;
      // threshold is covered by A2 and keeps the local value.
      expect(Object.keys(st().pending)).toEqual(['A2'])
      expect(st().known.ch1?.comp).toEqual({ threshold: -35, ratio: 2 })
    })
  })

  it('clearPending (reconnect) reconciles in-flight keys to confirmed', () => {
    st().applyState({ elementId: 'ch1', stage: 'comp', params: { threshold: -45 }, applied: true })
    st().localEdit('ch1', 'comp', { threshold: -30 })
    st().registerPending('A1', 'ch1', 'comp', { threshold: -30 })
    // A never-stored stage reverts to the Strom default.
    st().localEdit('ch1', 'gain', { gain: 6 })
    st().registerPending('A2', 'ch1', 'gain', { gain: 6 })
    st().clearPending()
    expect(st().pending).toEqual({})
    expect(st().known.ch1?.comp).toEqual({ threshold: -45 })
    expect(st().known.ch1?.gain).toEqual({ gain: 0 })
  })
})
