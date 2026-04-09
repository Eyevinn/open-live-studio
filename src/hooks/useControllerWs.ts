import { useEffect, useCallback, useRef } from 'react'
import { useProductionStore } from '@/store/production.store'

const WS_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000')
  .replace(/^http/, 'ws')

type OutboundMessage =
  | { type: 'CUT'; sourceId: string }
  | { type: 'TRANSITION'; sourceId: string; transitionType: string; durationMs?: number }
  | { type: 'TAKE' }
  | { type: 'SET_PVW'; sourceId: string }
  | { type: 'FTB'; active?: boolean; durationMs?: number }
  | { type: 'SET_OVL'; alpha: number }
  | { type: 'GO_LIVE' }
  | { type: 'CUT_STREAM' }
  | { type: 'GRAPHIC_ON'; overlayId: string }
  | { type: 'GRAPHIC_OFF'; overlayId: string }
  | { type: 'DSK_TOGGLE'; layer: number; visible?: boolean }
  | { type: 'MACRO_EXEC'; macroId: string }

/**
 * Opens a WebSocket connection to /ws/productions/:id/controller.
 * Syncs server-side tally state into the production store.
 * Returns a stable `send` function for dispatching controller messages.
 */
export function useControllerWs(productionId: string | null): (msg: OutboundMessage) => void {
  const wsRef = useRef<WebSocket | null>(null)
  const setPgm = useProductionStore((s) => s.setPgm)
  const setPvw = useProductionStore((s) => s.setPvw)
  const setLive = useProductionStore((s) => s.setLive)
  const setTBarPosition = useProductionStore((s) => s.setTBarPosition)

  useEffect(() => {
    if (!productionId) return

    const ws = new WebSocket(`${WS_BASE}/ws/productions/${productionId}/controller`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>
        switch (msg['type']) {
          case 'TALLY':
            if (typeof msg['pgm'] === 'string' || msg['pgm'] === null) {
              setPgm(msg['pgm'] as string)
            }
            if (typeof msg['pvw'] === 'string' || msg['pvw'] === null) {
              setPvw(msg['pvw'] as string)
            }
            break
          case 'OVL_STATE':
            if (typeof msg['alpha'] === 'number') {
              setTBarPosition(msg['alpha'] as number)
            }
            break
          case 'ON_AIR':
            setLive(!!msg['value'])
            break
          // DSK_STATE, MACRO_EXECUTED, MACRO_ERROR — handled by consumers if needed
        }
      } catch {
        // ignore malformed frames
      }
    }

    ws.onerror = () => {
      // Connection errors are silent — the controller degrades gracefully
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [productionId, setPgm, setPvw, setLive, setTBarPosition])

  const send = useCallback((msg: OutboundMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  return send
}
