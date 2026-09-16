import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useProductionStore } from '@/store/production.store'
import type { OutboundMessage } from '@/hooks/useControllerWs'

const ORIGINAL_TITLE = typeof document !== 'undefined' ? document.title : ''

/**
 * Pre-deactivation idle-timeout warning surfaced *in the mixer view* (#130).
 *
 * The Productions LIST page already shows a countdown badge, but the operator
 * actually works in the Studio/mixer view where — until now — no warning was
 * shown at all. This banner consumes the idle-warning signal from the backend
 * (stored on `production.store.idleWarning`, populated by the controller-WS
 * IDLE_WARNING handler; paired backend work: open-live#290) and gives the
 * operator a one-click "Keep active" affordance that sends a KEEP_ALIVE message
 * to reset the backend idle timer.
 *
 * Because the reported failure mode is a *backgrounded* tab, an in-page banner
 * alone is not enough — so we also drive a title-bar countdown and (with
 * permission) a Notifications-API notification so the warning is visible from
 * another tab.
 */
export function IdleWarningBanner({ send }: { send: (msg: OutboundMessage) => void }) {
  const idleWarning = useProductionStore((s) => s.idleWarning)
  const setIdleWarning = useProductionStore((s) => s.setIdleWarning)
  const [now, setNow] = useState(() => Date.now())
  const notifiedRef = useRef(false)

  const active = idleWarning !== null
  const remainingMs = active ? Math.max(0, idleWarning.deadlineMs - now) : 0
  const remainingSec = Math.ceil(remainingMs / 1000)
  const countdown = `${Math.floor(remainingSec / 60)}:${String(remainingSec % 60).padStart(2, '0')}`

  // Tick once per second only while a warning is active.
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  // Title-bar countdown so a backgrounded tab shows the warning at a glance.
  useEffect(() => {
    if (!active) {
      document.title = ORIGINAL_TITLE
      return
    }
    document.title = `⚠ IDLE in ${countdown} — ${ORIGINAL_TITLE}`
    return () => { document.title = ORIGINAL_TITLE }
  }, [active, countdown])

  // One OS-level notification per warning so a user in another tab is alerted.
  // Notifications require prior permission; never prompt here — only fire if the
  // user already granted it (requesting on page load is bad practice / blocked).
  useEffect(() => {
    if (!active) {
      notifiedRef.current = false
      return
    }
    if (notifiedRef.current) return
    notifiedRef.current = true
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('Open Live Studio', {
          body: 'This production will go IDLE soon — return to the tab to keep it active.',
          tag: 'open-live-idle-warning',
        })
      } catch {
        // Some browsers throw when constructing Notification outside a SW; ignore.
      }
    }
  }, [active])

  if (!active) return null

  const keepActive = () => {
    send({ type: 'KEEP_ALIVE' })
    // Optimistically dismiss; the backend confirms via IDLE_WARNING_CLEARED or a
    // fresh IDLE_WARNING if the timer is still winding down.
    setIdleWarning(null)
  }

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
          This production will go IDLE in{' '}
          <span className="font-mono tabular-nums">{countdown}</span> — keep it active to stay on the air.
        </span>
      </div>
      <Button size="sm" onClick={keepActive} className="shrink-0 bg-white text-amber-700 hover:brightness-95 border-0 font-bold">
        Keep active
      </Button>
    </div>
  )
}
