import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROC_SEND_INTERVAL_MS, ProcSetCoalescer } from './audio-proc-sender'
import type { ProcSetMessage } from './audio-processing'

describe('ProcSetCoalescer', () => {
  let sent: ProcSetMessage[]
  let sentAt: number[]
  let coalescer: ProcSetCoalescer
  let n: number

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    sent = []
    sentAt = []
    n = 0
    coalescer = new ProcSetCoalescer({ send: (m) => { sent.push(m); sentAt.push(Date.now()) }, makeCmdId: () => `c${++n}` })
  })
  afterEach(() => vi.useRealTimers())

  it('a 5 s drag at 60 Hz sends at most ~10/s and ends on the release value', () => {
    // Simulate pointer moves every ~16 ms for 5 s on the comp threshold.
    let value = -20
    for (let t = 0; t < 5000; t += 16) {
      value = -20 - (t / 5000) * 30
      coalescer.queue('ch1', 'comp', { threshold: Math.round(value * 10) / 10 })
      vi.advanceTimersByTime(16)
    }
    const release = -50
    coalescer.queue('ch1', 'comp', { threshold: release })
    vi.advanceTimersByTime(PROC_SEND_INTERVAL_MS)

    expect(sent.length).toBeLessThanOrEqual(5 * (1000 / PROC_SEND_INTERVAL_MS) + 2)
    expect(sent.length / 5).toBeLessThanOrEqual(10)
    // Consecutive frames for the stage are never closer than the interval
    // (which is also above the server's 150 ms per-stage debounce).
    for (let i = 1; i < sentAt.length; i++) expect(sentAt[i]! - sentAt[i - 1]!).toBeGreaterThanOrEqual(PROC_SEND_INTERVAL_MS)
    expect(PROC_SEND_INTERVAL_MS).toBeGreaterThan(150)
    expect(sent.at(-1)!.params).toEqual({ threshold: release })
    expect(sent.every((m) => m.type === 'AUDIO_PROC_SET' && m.elementId === 'ch1' && m.stage === 'comp' && m.cmdId)).toBe(true)
  })

  it('sends the first change immediately (leading edge)', () => {
    coalescer.queue('main', 'limiter', { enabled: true })
    expect(sent).toEqual([{ type: 'AUDIO_PROC_SET', elementId: 'main', stage: 'limiter', params: { enabled: true }, cmdId: 'c1' }])
  })

  it('merges keys changed within one window into a single frame', () => {
    coalescer.queue('ch2', 'eq', { bands: [{ band: 1, gain: 3 }] })
    coalescer.queue('ch2', 'eq', { bands: [{ band: 2, gain: -4 }] })
    coalescer.queue('ch2', 'eq', { bands: [{ band: 1, gain: 5 }] })
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(PROC_SEND_INTERVAL_MS)
    expect(sent).toHaveLength(2)
    expect(sent[1]?.params).toEqual({ bands: [{ band: 1, gain: 5 }, { band: 2, gain: -4 }] })
  })

  it('throttles each element:stage independently', () => {
    coalescer.queue('ch1', 'gain', { gain: 1 })
    coalescer.queue('ch1', 'gate', { threshold: -30 })
    coalescer.queue('ch2', 'gain', { gain: 2 })
    expect(sent.map((m) => `${m.elementId}:${m.stage}`)).toEqual(['ch1:gain', 'ch1:gate', 'ch2:gain'])
  })

  it('refuses out-of-range values and misplaced stages without sending', () => {
    expect(coalescer.queue('ch1', 'gain', { gain: 21 })).toMatch(/-20 to 20/)
    expect(coalescer.queue('ch1', 'limiter', { enabled: true })).toMatch(/not valid/)
    vi.advanceTimersByTime(1000)
    expect(sent).toHaveLength(0)
  })

  it('reports sent frames with their cmdId', () => {
    const onSent = vi.fn()
    const c = new ProcSetCoalescer({ send: () => {}, onSent, makeCmdId: () => 'x' })
    c.queue('ch1', 'hpf', { freq: 120 })
    expect(onSent).toHaveBeenCalledWith('x', 'ch1', 'hpf', { freq: 120 })
  })

  it('dispose flushes anything still queued', () => {
    coalescer.queue('ch1', 'comp', { ratio: 2 })
    coalescer.queue('ch1', 'comp', { ratio: 8 })
    expect(sent).toHaveLength(1)
    coalescer.dispose()
    expect(sent).toHaveLength(2)
    expect(sent[1]?.params).toEqual({ ratio: 8 })
    vi.advanceTimersByTime(1000)
    expect(sent).toHaveLength(2)
  })
})
