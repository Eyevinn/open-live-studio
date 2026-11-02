import { describe, expect, it } from 'vitest'
import { LATENCY_RANGE_MESSAGE, validateLatency } from './latency'

describe('validateLatency', () => {
  it.each(['10', '0', '8001', '1.5', '-20', 'abc'])('rejects %s with the range message', (input) => {
    expect(validateLatency(input)).toEqual({ ok: false, message: LATENCY_RANGE_MESSAGE })
  })

  it('states the backend range in the message', () => {
    expect(LATENCY_RANGE_MESSAGE).toBe('Latency must be between 20 and 8000 ms.')
  })

  it.each([
    ['20', 20],
    ['8000', 8000],
    ['125', 125],
    [' 300 ', 300],
  ])('accepts %s', (input, value) => {
    expect(validateLatency(input)).toEqual({ ok: true, value })
  })

  it('accepts an empty field as "no value"', () => {
    expect(validateLatency('')).toEqual({ ok: true, value: undefined })
    expect(validateLatency('   ')).toEqual({ ok: true, value: undefined })
  })
})
