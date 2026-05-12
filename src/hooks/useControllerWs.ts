import { useEffect, useCallback, useRef } from 'react'
import { useProductionStore } from '@/store/production.store'
import { useAudioStore } from '@/store/audio.store'

import { BASE } from '@/lib/base'
const WS_BASE = BASE.replace(/^http/, 'ws')

export type OutboundMessage =
  | { type: 'CUT'; mixerInput: string; afvRampMs?: number }
  | { type: 'TRANSITION'; mixerInput: string; transitionType: string; durationMs?: number; afvRampMs?: number }
  | { type: 'TAKE'; afvRampMs?: number }
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
  | { type: 'PFL_SET'; elementId: string; enabled: boolean; volume?: number }
  | { type: 'AUX_SEND_SET'; elementId: string; auxBus: number; level: number; enabled: boolean }
  | { type: 'AUX_MASTER_SET'; auxBus: number; volume: number; muted: boolean }
  | { type: 'GRP_SEND_SET'; elementId: string; grpBus: number; level: number; enabled: boolean }
  | { type: 'GRP_MASTER_SET'; grpBus: number; volume: number; muted: boolean }
  | { type: 'SOURCE_OFFSET_SET'; mixerInput: string; offsetMs: number }

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
  const applyPfl             = useAudioStore((s) => s.applyPfl)
  const applyAuxSend         = useAudioStore((s) => s.applyAuxSend)
  const applyAuxMaster       = useAudioStore((s) => s.applyAuxMaster)
  const applyGrpSend         = useAudioStore((s) => s.applyGrpSend)
  const applyGrpMaster       = useAudioStore((s) => s.applyGrpMaster)
  const applyMeter           = useAudioStore((s) => s.applyMeter)
  const applySourceOffset    = useProductionStore((s) => s.applySourceOffset)

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
          case 'PFL_STATE': {
            if (typeof msg['elementId'] === 'string' && typeof msg['enabled'] === 'boolean') {
              applyPfl(msg['elementId'] as string, msg['enabled'] as boolean)
            }
            break
          }
          case 'AUX_SEND_STATE': {
            if (typeof msg['elementId'] === 'string' && typeof msg['auxBus'] === 'number' && typeof msg['level'] === 'number' && typeof msg['enabled'] === 'boolean') {
              applyAuxSend(msg['elementId'] as string, msg['auxBus'] as number, msg['level'] as number, msg['enabled'] as boolean)
            }
            break
          }
          case 'AUX_MASTER_STATE': {
            if (typeof msg['auxBus'] === 'number' && typeof msg['volume'] === 'number' && typeof msg['muted'] === 'boolean') {
              applyAuxMaster(msg['auxBus'] as number, msg['volume'] as number, msg['muted'] as boolean)
            }
            break
          }
          case 'GRP_SEND_STATE': {
            if (typeof msg['elementId'] === 'string' && typeof msg['grpBus'] === 'number' && typeof msg['level'] === 'number' && typeof msg['enabled'] === 'boolean') {
              applyGrpSend(msg['elementId'] as string, msg['grpBus'] as number, msg['level'] as number, msg['enabled'] as boolean)
            }
            break
          }
          case 'GRP_MASTER_STATE': {
            if (typeof msg['grpBus'] === 'number' && typeof msg['volume'] === 'number' && typeof msg['muted'] === 'boolean') {
              applyGrpMaster(msg['grpBus'] as number, msg['volume'] as number, msg['muted'] as boolean)
            }
            break
          }
          case 'SOURCE_OFFSET_STATE': {
            if (typeof msg['mixerInput'] === 'string' && typeof msg['offsetMs'] === 'number') {
              applySourceOffset(msg['mixerInput'] as string, msg['offsetMs'] as number)
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
  }, [productionId, setPgm, setPvw, setTBarPosition, setDskState, applyLevel, applyMuted, applyAfvByMixerInput, applyPfl, applyAuxSend, applyAuxMaster, applyGrpSend, applyGrpMaster, applyMeter, applySourceOffset])

  const send = useCallback((msg: OutboundMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  return send
}
