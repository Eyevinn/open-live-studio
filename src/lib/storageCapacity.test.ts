import { describe, expect, it } from 'vitest'
import type { ApiStorageCapacity } from './api'
import {
  CAPACITY_FORBIDDEN_TEXT,
  CAPACITY_LOADING_TEXT,
  CAPACITY_NOT_SUPPORTED_TEXT,
  CAPACITY_UNREACHABLE_TEXT,
  capacityText,
  formatBytesDecimal,
  formatMbps,
  formatMinutes,
} from './storageCapacity'

const CHECKED_AT = '2026-11-02T10:00:00.000Z'

function available(overrides: Partial<Extract<ApiStorageCapacity, { status: 'available' }>> = {}): ApiStorageCapacity {
  return {
    status: 'available',
    totalBytes: 1e12,
    freeBytes: 678e9,
    scope: 'server',
    referenceBitrateKbps: 10000,
    estimatedMinutes: 9040,
    checkedAt: CHECKED_AT,
    ...overrides,
  }
}

describe('formatBytesDecimal', () => {
  it('uses decimal units (1 GB = 1e9 bytes)', () => {
    expect(formatBytesDecimal(678e9)).toBe('678 GB')
    expect(formatBytesDecimal(1e9)).toBe('1 GB')
    expect(formatBytesDecimal(1024 ** 3)).toBe('1.1 GB')
  })

  it('formats terabytes and drops a trailing .0', () => {
    expect(formatBytesDecimal(1e12)).toBe('1 TB')
    expect(formatBytesDecimal(1.5e12)).toBe('1.5 TB')
    expect(formatBytesDecimal(12.34e12)).toBe('12.3 TB')
  })

  it('keeps one decimal below 100 and whole numbers from 100', () => {
    expect(formatBytesDecimal(12.34e6)).toBe('12.3 MB')
    expect(formatBytesDecimal(123.4e6)).toBe('123 MB')
    expect(formatBytesDecimal(999)).toBe('999 B')
    expect(formatBytesDecimal(1500)).toBe('1.5 KB')
  })

  it('carries a rounded 1000 into the next unit', () => {
    expect(formatBytesDecimal(999.6e9)).toBe('1 TB')
  })

  it('treats zero, negative and non-finite input as 0 B', () => {
    expect(formatBytesDecimal(0)).toBe('0 B')
    expect(formatBytesDecimal(-5)).toBe('0 B')
    expect(formatBytesDecimal(Number.NaN)).toBe('0 B')
  })
})

describe('formatMinutes', () => {
  it('adds a thousands separator', () => {
    expect(formatMinutes(8589)).toBe('8,589')
    expect(formatMinutes(1234567)).toBe('1,234,567')
    expect(formatMinutes(999)).toBe('999')
  })

  it('floors fractions and clamps to 0', () => {
    expect(formatMinutes(12.9)).toBe('12')
    expect(formatMinutes(0)).toBe('0')
    expect(formatMinutes(-3)).toBe('0')
  })
})

describe('formatMbps', () => {
  it('converts kbps to Mbit/s without trailing zeros', () => {
    expect(formatMbps(10000)).toBe('10')
    expect(formatMbps(2500)).toBe('2.5')
  })
})

describe('capacityText', () => {
  it('renders the available line', () => {
    expect(capacityText({ kind: 'loaded', result: available() })).toBe('Free: 678 GB of 1 TB (~9,040 min at 10 Mbit/s)')
  })

  it('appends the bucket-quota marker', () => {
    expect(capacityText({ kind: 'loaded', result: available({ scope: 'bucket-quota', totalBytes: 100e9, freeBytes: 60e9, estimatedMinutes: 800 }) }))
      .toBe('Free: 60 GB of 100 GB (~800 min at 10 Mbit/s) · bucket quota')
  })

  it('maps each unavailable reason', () => {
    const unavailable = (reason: 'forbidden' | 'not-supported' | 'unreachable'): ApiStorageCapacity =>
      ({ status: 'unavailable', reason, checkedAt: CHECKED_AT })
    expect(capacityText({ kind: 'loaded', result: unavailable('forbidden') })).toBe(CAPACITY_FORBIDDEN_TEXT)
    expect(capacityText({ kind: 'loaded', result: unavailable('not-supported') })).toBe(CAPACITY_NOT_SUPPORTED_TEXT)
    expect(capacityText({ kind: 'loaded', result: unavailable('unreachable') })).toBe(CAPACITY_UNREACHABLE_TEXT)
  })

  it('shows loading and request-error text', () => {
    expect(capacityText({ kind: 'loading' })).toBe(CAPACITY_LOADING_TEXT)
    expect(capacityText({ kind: 'error' })).toBe(CAPACITY_UNREACHABLE_TEXT)
  })

  it('uses the exact texts from the issue', () => {
    expect(CAPACITY_LOADING_TEXT).toBe('Checking free space…')
    expect(CAPACITY_FORBIDDEN_TEXT).toBe('Free space unavailable: this key lacks MinIO admin storage-info permission.')
    expect(CAPACITY_NOT_SUPPORTED_TEXT).toBe('Free space not reported by this storage.')
    expect(CAPACITY_UNREACHABLE_TEXT).toBe('Free space unavailable (storage unreachable).')
  })
})
