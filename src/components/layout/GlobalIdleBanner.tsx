import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { hasControllerConnection } from '@/hooks/useControllerWs'

// Show the banner once the active production is within this many seconds of an
// idle auto-deactivation, matching the ≤60 s "nearing timeout" window the
// Productions list already uses for its per-row countdown badge.
const IDLE_WARNING_WINDOW_SEC = 60

// Keep the backend-supplied idle expiry fresh regardless of which view is
// mounted: the Setup panels only poll while their own panel is open, so on the
// I/O and Productions views this banner would otherwise go stale. A light poll
// (only while a production is active) mirrors the app's 5 s REST cadence.
const POLL_INTERVAL_MS = 5000

/**
 * Session-level idle-timeout warning surfaced *outside* the mixer view (#140).
 *
 * The mixer view has its own `IdleWarningBanner` (with a WS "Keep active"
 * button), and the Productions LIST already shows a per-row countdown badge —
 * but on the I/O (Setup) view and elsewhere the operator got no warning that
 * the selected production is about to be auto-deactivated. This banner closes
 * that gap: it reads the backend-authoritative `idleExpiresAt` for the active
 * production (the same field the Productions list badge uses) and, when the
 * countdown enters the warning window with no subscribers, shows an amber
 * banner with a one-click link back to the mixer.
 *
 * It deliberately does not send WS frames itself: `useSessionKeepAlive` already
 * keeps the production alive while any Studio view is open, so the affordance
 * here is discoverability — get the operator back to the mixer — not a second
 * keep-alive path. To avoid a duplicate banner, it suppresses itself whenever a
 * live mixer controller connection is held for the active production (i.e. the
 * mixer view is mounted and its own `IdleWarningBanner` is in charge).
 */
export function GlobalIdleBanner() {
  const activeProductionId = useProductionStore((s) => s.activeProductionId)
  const production = useProductionsStore((s) =>
    s.productions.find((p) => p.id === activeProductionId),
  )
  const fetchAll = useProductionsStore((s) => s.fetchAll)
  const [now, setNow] = useState(() => Date.now())

  const isActive = production?.status === 'active'
  const idleExpiresAt = production?.idleExpiresAt ?? null
  const subscriberCount = production?.subscriberCount ?? 0

  const remainingMs = isActive && idleExpiresAt != null ? Math.max(0, idleExpiresAt - now) : null
  const remainingSec = remainingMs !== null ? Math.ceil(remainingMs / 1000) : null

  // Suppress on the mixer view — its own IdleWarningBanner (with the WS
  // Keep-active button) owns the warning there.
  const mixerOwnsWarning = activeProductionId != null && hasControllerConnection(activeProductionId)

  const active =
    !mixerOwnsWarning &&
    remainingSec !== null &&
    remainingSec <= IDLE_WARNING_WINDOW_SEC &&
    subscriberCount === 0

  // Tick once per second only while the warning is showing.
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  // Refresh the backend idle expiry while a production is active, so the
  // countdown stays accurate on views that don't otherwise poll productions.
  useEffect(() => {
    if (!activeProductionId) return
    const id = setInterval(() => void fetchAll(), POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [activeProductionId, fetchAll])

  if (!active || remainingSec === null) return null

  const isDeactivating = remainingSec === 0
  const countdown = `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, '0')}`

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-center justify-between gap-3 px-4 py-2 bg-amber-600 text-white border-b border-amber-400"
    >
      <div className="flex items-center gap-2 min-w-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
          <circle cx="12" cy="12" r="9" stroke="white" strokeWidth="2.5" />
          <path d="M12 7v5l3 3" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-semibold truncate">
          {isDeactivating ? (
            <>&ldquo;{production?.name}&rdquo; is going IDLE — de-activating now.</>
          ) : (
            <>
              &ldquo;{production?.name}&rdquo; will go IDLE in{' '}
              <span className="font-mono tabular-nums">{countdown}</span> — open the mixer to keep it active.
            </>
          )}
        </span>
      </div>
      <Link
        to={`/studio?production=${activeProductionId}`}
        className="shrink-0 inline-flex items-center rounded bg-white px-3 py-1 text-sm font-bold text-amber-700 hover:brightness-95"
      >
        Open mixer
      </Link>
    </div>
  )
}
