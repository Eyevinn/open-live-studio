import { useEffect } from 'react'
import { useProductionStore } from '@/store/production.store'
import { getApiToken } from '@/lib/sat'
import { BASE } from '@/lib/base'
import { hasControllerConnection, subscribeControllerRegistry } from '@/hooks/useControllerWs'

const WS_BASE = BASE.replace(/^http/, 'ws')

// Reconnect uses capped exponential backoff and never gives up permanently,
// mirroring useControllerWs (#130): an operator who is merely doing routine
// setup outside the mixer must not be silently counted as absent.
const WS_RECONNECT_BASE_DELAY_MS = 1000
const WS_RECONNECT_MAX_DELAY_MS = 15000

// Cadence of the explicit KEEP_ALIVE heartbeat. Well under the backend's 300 s
// idle watchdog so a single missed beat never risks auto-deactivation.
const KEEP_ALIVE_INTERVAL_MS = 60_000

/**
 * Session-level idle keep-alive (#139).
 *
 * The backend idle-watchdog auto-deactivates a production after 300 s with zero
 * controller subscribers. Until now the only controller subscription came from
 * the mixer view (`useControllerWs`), so navigating to the Productions list or
 * the I/O setup view tore that socket down and silently re-armed the idle timer
 * — an operator doing routine setup could have their production deactivated out
 * from under them.
 *
 * This hook is mounted once at the app-shell (session) level, so it persists
 * across in-app navigation between the Productions, Setup and Studio views. It
 * holds a lightweight controller WS subscription for the currently-selected
 * production and sends periodic KEEP_ALIVE frames, keeping the production alive
 * while ANY Studio view for it is open.
 *
 * It deliberately does NOT duplicate the mixer connection: while the mixer view
 * is mounted, `useControllerWs` already holds a subscriber (and drives the full
 * state sync). This hook registers as a listener on that shared registry and
 * only opens its own socket when no full mixer connection is present, so the
 * backend never sees more than one controller subscriber per production — there
 * is no GPU-cost tradeoff, a controller connection already counts as legitimate
 * activity; this just stops it from dropping during normal operator navigation.
 *
 * Studio-only change: no backend contract change. KEEP_ALIVE and the
 * `/ws/productions/:id/controller` endpoint already exist.
 */
export function useSessionKeepAlive(): void {
  const productionId = useProductionStore((s) => s.activeProductionId)

  useEffect(() => {
    if (!productionId) return

    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null
    let reconnectCount = 0

    const clearTimers = () => {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null }
    }

    const teardownSocket = () => {
      clearTimers()
      if (ws) {
        // Detach handlers so our own close does not schedule a reconnect.
        ws.onopen = null
        ws.onclose = null
        ws.onerror = null
        ws.onmessage = null
        ws.close()
        ws = null
      }
    }

    const sendKeepAlive = () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'KEEP_ALIVE' }))
      }
    }

    const scheduleReconnect = () => {
      if (cancelled) return
      const delay = Math.min(
        WS_RECONNECT_BASE_DELAY_MS * 2 ** reconnectCount,
        WS_RECONNECT_MAX_DELAY_MS,
      )
      reconnectCount++
      reconnectTimer = setTimeout(() => { void connect() }, delay)
    }

    const connect = async () => {
      if (cancelled) return
      // Defer entirely to the mixer connection when it is present, and make sure
      // we are not holding a redundant socket.
      if (hasControllerConnection(productionId)) {
        teardownSocket()
        return
      }
      if (ws) return // already connected or connecting

      const token = await getApiToken().catch(() => undefined)
      if (cancelled || hasControllerConnection(productionId)) return

      const wsUrl = new URL(`${WS_BASE}/ws/productions/${productionId}/controller`)
      if (token) wsUrl.searchParams.set('token', token)

      const socket = new WebSocket(wsUrl.toString())
      ws = socket

      socket.onopen = () => {
        reconnectCount = 0
        // Send an immediate beat on connect, then keep beating on an interval so
        // the backend idle timer stays reset while the operator works elsewhere.
        sendKeepAlive()
        keepAliveTimer = setInterval(sendKeepAlive, KEEP_ALIVE_INTERVAL_MS)
      }

      // This session-level subscription intentionally ignores inbound state
      // frames — the mixer view owns full state sync. Its sole job is to keep a
      // subscriber attached so the idle watchdog does not fire.
      socket.onmessage = null

      socket.onerror = () => {
        // onclose fires next and schedules the reconnect.
      }

      socket.onclose = () => {
        if (ws === socket) ws = null
        if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null }
        if (cancelled) return
        if (hasControllerConnection(productionId)) return // mixer took over
        scheduleReconnect()
      }
    }

    // Re-evaluate whenever a mixer connection opens or closes: hand off to the
    // mixer when it appears, and reclaim the keep-alive when it goes away.
    const onRegistryChange = () => {
      if (cancelled) return
      if (hasControllerConnection(productionId)) {
        teardownSocket()
      } else if (!ws && !reconnectTimer) {
        reconnectCount = 0
        void connect()
      }
    }
    const unsubscribe = subscribeControllerRegistry(onRegistryChange)

    // Reconnect promptly when the operator returns to the tab or the network
    // comes back, rather than waiting out the current backoff delay (#130).
    const reconnectNow = () => {
      if (cancelled) return
      if (ws || hasControllerConnection(productionId)) return
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      reconnectCount = 0
      void connect()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconnectNow()
    }
    window.addEventListener('online', reconnectNow)
    window.addEventListener('focus', reconnectNow)
    document.addEventListener('visibilitychange', onVisibility)

    void connect()

    return () => {
      cancelled = true
      unsubscribe()
      window.removeEventListener('online', reconnectNow)
      window.removeEventListener('focus', reconnectNow)
      document.removeEventListener('visibilitychange', onVisibility)
      teardownSocket()
    }
  }, [productionId])
}
