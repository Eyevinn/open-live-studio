import type { ApiStorageCapacity } from './api'

/**
 * Storage tab capacity line (studio#245). Pure helpers: byte and minute
 * formatting plus the per-row text for each capacity state. Units are decimal
 * (1 GB = 1e9 bytes), matching how object stores and disks are sold.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

/** Groups an integer's digits with `,` (locale-independent, so output is stable). */
function groupThousands(n: number): string {
  const sign = n < 0 ? '-' : ''
  return sign + String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Formats a byte count with decimal units: `678 GB`, `1.5 TB`, `12.3 MB`.
 * Values of 100 or more in their unit are whole numbers; smaller values keep one
 * decimal, dropped when it is `.0`.
 */
export function formatBytesDecimal(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let unit = 0
  let value = bytes
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  if (unit === 0) return `${Math.round(value)} B`
  let text = value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '')
  // Rounding can carry into the next unit (999.6 GB → 1000 GB); show 1 TB instead.
  if (text === '1000' && unit < UNITS.length - 1) {
    unit++
    text = '1'
  }
  return `${text} ${UNITS[unit]}`
}

/** Whole minutes with a thousands separator: `8589` → `8,589`. */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0'
  return groupThousands(Math.floor(minutes))
}

/** kbps → Mbit/s text without trailing zeros: `10000` → `10`, `2500` → `2.5`. */
export function formatMbps(kbps: number): string {
  return String(Math.round((kbps / 1000) * 100) / 100)
}

/** Per-row capacity request state in the Storage tab. */
export type CapacityState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'loaded'; result: ApiStorageCapacity }

export const CAPACITY_LOADING_TEXT = 'Checking free space…'
export const CAPACITY_FORBIDDEN_TEXT = 'Free space unavailable: this key lacks MinIO admin storage-info permission.'
export const CAPACITY_NOT_SUPPORTED_TEXT = 'Free space not reported by this storage.'
export const CAPACITY_UNREACHABLE_TEXT = 'Free space unavailable (storage unreachable).'

/** The text shown under a connection's subtitle for its capacity state. */
export function capacityText(state: CapacityState): string {
  if (state.kind === 'loading') return CAPACITY_LOADING_TEXT
  if (state.kind === 'error') return CAPACITY_UNREACHABLE_TEXT
  const r = state.result
  if (r.status === 'unavailable') {
    if (r.reason === 'forbidden') return CAPACITY_FORBIDDEN_TEXT
    if (r.reason === 'not-supported') return CAPACITY_NOT_SUPPORTED_TEXT
    return CAPACITY_UNREACHABLE_TEXT
  }
  const line =
    `Free: ${formatBytesDecimal(r.freeBytes)} of ${formatBytesDecimal(r.totalBytes)} ` +
    `(~${formatMinutes(r.estimatedMinutes)} min at ${formatMbps(r.referenceBitrateKbps)} Mbit/s)`
  return r.scope === 'bucket-quota' ? `${line} · bucket quota` : line
}
