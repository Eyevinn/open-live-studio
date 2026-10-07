import { useCallback, useEffect, useRef } from 'react'

/**
 * Leading-and-trailing throttle for continuous controls (e.g. effect sliders).
 *
 * The returned function fires immediately on the first call, then at most once
 * per `intervalMs` while calls keep coming, and always fires a final trailing
 * call with the latest arguments so the last value (the release position) is
 * never lost. This lets a dragged slider update on-air live without flooding the
 * controller WebSocket and tripping the server rate limit (open-live-studio#181).
 *
 * Mirrors the per-key debounce in `src/lib/debounce.ts`, but as a React hook so
 * the throttle state survives re-renders while the latest `callback` closure is
 * always invoked (it is read from a ref, so a changing callback identity does not
 * reset the timer).
 */
export function useThrottledCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  intervalMs: number,
): (...args: Args) => void {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const lastRunRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Args | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  return useCallback(
    (...args: Args) => {
      const now = Date.now()
      const elapsed = now - lastRunRef.current
      if (elapsed >= intervalMs) {
        lastRunRef.current = now
        callbackRef.current(...args)
        return
      }
      pendingRef.current = args
      if (timerRef.current === null) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          if (pendingRef.current !== null) {
            lastRunRef.current = Date.now()
            const pending = pendingRef.current
            pendingRef.current = null
            callbackRef.current(...pending)
          }
        }, intervalMs - elapsed)
      }
    },
    [intervalMs],
  )
}
