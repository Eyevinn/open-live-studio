import { useEffect, useCallback, useRef } from 'react'
import { useProductionStore } from '@/store/production.store'
import { useAudioStore } from '@/store/audio.store'

const WS_BASE = (
  (typeof window !== 'undefined' && (window as unknown as { _env_?: { OPEN_LIVE_URL?: string } })._env_?.OPEN_LIVE_URL) ||
  import.meta.env.OPEN_LIVE_URL ||
  'http://localhost:3000'
).replace(/^http/, 'ws')

export type OutboundMessage =
  | { type: 'CUT'; mixerInput: string }
  | { type: 'TRANSITION'; mixerInput: string; transitionType: string; durationMs?: number }
  | { type: 'TAKE' }
  | { type: 'SET_PVW'; mixerInput: string }
  | { type: 'FTB'; active?: boolean; durationMs?: number }
  | { type: 'SET_OVL'; alpha: number }
  | { type: 'GO_LIVE' }
  | { type: 'CUT_STREAM' }
  | { type: 'GRAPHIC_ON'; overlayId: string }
  | { type: 'GRAPHIC_OFF'; overlayId: string }
  | { type: 'DSK_TOGGLE'; layer: number; visible?: boolean }
  | { type: 'MACRO_EXEC'; macroId: string }
  | { type: 'AUDIO_SET'; elementId: string; property: 'volume' | 'mute'; value: number | boolean; ramp_ms?: number }
  | { type: 'AFV_SET'; mixerInput: string; enabled: boolean }

/**
 * Opens a WebSocket connection to /ws/productions/:id/controller.
 * Syncs server-side tally state into the production store.
 * Returns a stable `send` function for dispatching controller messages.
 */
export function useControllerWs(productionId: string | null): (msg: OutboundMessage) => void {
  const wsRef = useRef<WebSocket | null>(null)
  const setPgm = useProductionStore((s) => s.setPgm)
  const setPvw = useProductionStore((s) => s.setPvw)
  const setTBarPosition = useProductionStore((s) => s.setTBarPosition)
  const setDskState = useProductionStore((s) => s.setDskState)
  const applyLevel           = useAudioStore((s) => s.applyLevel)
  const applyMuted           = useAudioStore((s) => s.applyMuted)
  const applyAfvByMixerInput = useAudioStore((s) => s.applyAfvByMixerInput)
  const applyMeter           = useAudioStore((s) => s.applyMeter)

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
          case 'DSK_STATE':
            if (typeof msg['layer'] === 'number' && typeof msg['visible'] === 'boolean') {
              setDskState(msg['layer'] as number, msg['visible'] as boolean)
            }
            break
          case 'AUDIO_STATE':
            if (typeof msg['elementId'] === 'string') {
              if (msg['property'] === 'volume' && typeof msg['value'] === 'number') {
                applyLevel(msg['elementId'] as string, msg['value'] as number)
              } else if (msg['property'] === 'mute' && typeof msg['value'] === 'boolean') {
                applyMuted(msg['elementId'] as string, msg['value'] as boolean)
              }
            }
            break
          case 'AFV_STATE': {
            // applyAfvByMixerInput handles the race between WS messages and the
            // REST elements fetch — it queues the value if elements aren't loaded yet.
            if (typeof msg['mixerInput'] === 'string' && typeof msg['enabled'] === 'boolean') {
              applyAfvByMixerInput(msg['mixerInput'] as string, msg['enabled'] as boolean)
            }
            break
          }
          case 'METER_DATA':
            if (typeof msg['elementId'] === 'string' && Array.isArray(msg['peak']) && Array.isArray(msg['rms'])) {
              applyMeter(msg['elementId'] as string, msg['peak'] as number[], msg['rms'] as number[])
            }
            break
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
  }, [productionId, setPgm, setPvw, setTBarPosition, setDskState, applyLevel, applyMuted, applyAfvByMixerInput, applyMeter])

  const send = useCallback((msg: OutboundMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  return send
}
