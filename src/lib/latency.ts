/**
 * SRT/EFP source latency limits (studio#242, OL-44). They mirror the backend's
 * `latency` rule on source create and patch (open-live `src/routes/sources.ts`:
 * an integer from 20 to 8000 ms), so the operator gets inline feedback instead
 * of the generic "Validation error" a rejected PATCH would produce.
 */
export const LATENCY_MIN_MS = 20
export const LATENCY_MAX_MS = 8000
export const LATENCY_DEFAULT_MS = 125

export const LATENCY_RANGE_MESSAGE = `Latency must be between ${LATENCY_MIN_MS} and ${LATENCY_MAX_MS} ms.`

/**
 * `ok: true` with `value: undefined` means the field was left empty: New
 * Source then uses {@link LATENCY_DEFAULT_MS} and Edit Source leaves the stored
 * latency unchanged.
 */
export type LatencyValidation =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string }

/** Validate a latency field's raw string: empty, or a whole number in range. */
export function validateLatency(input: string): LatencyValidation {
  const raw = input.trim()
  if (raw === '') return { ok: true, value: undefined }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < LATENCY_MIN_MS || parsed > LATENCY_MAX_MS) {
    return { ok: false, message: LATENCY_RANGE_MESSAGE }
  }
  return { ok: true, value: parsed }
}
