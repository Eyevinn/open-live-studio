import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyedDebounce } from './debounce'

describe('KeyedDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows the first event for a key and blocks repeats within the window', () => {
    const d = new KeyedDebounce()
    expect(d.try(1, 1000)).toBe(true)
    expect(d.try(1, 1000)).toBe(false)
    expect(d.try(1, 1000)).toBe(false)
  })

  it('does not block different keys', () => {
    const d = new KeyedDebounce()
    expect(d.try(1, 1000)).toBe(true)
    expect(d.try(2, 1000)).toBe(true)
  })

  it('allows the key again once the debounce window elapses', () => {
    const d = new KeyedDebounce()
    expect(d.try(1, 1000)).toBe(true)
    vi.advanceTimersByTime(999)
    expect(d.try(1, 1000)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(d.try(1, 1000)).toBe(true)
  })

  it('clear() resets all keys immediately', () => {
    const d = new KeyedDebounce()
    expect(d.try(1, 1000)).toBe(true)
    d.clear()
    expect(d.try(1, 1000)).toBe(true)
  })
})
