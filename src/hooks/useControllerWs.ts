import { useEffect, useCallback, useRef } from 'react'
import { useProductionStore, type PipZone, type PipConfig, type PipTransforms, type VideoEffect, type EffectTarget, type ClipState } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useAudioStore } from '@/store/audio.store'
import { useGuestsStore } from '@/store/guests.store'
import { useToastStore } from '@/store/toast.store'
import type { GuestState, ReturnMode } from '@/lib/api'
import { getApiToken, wsAuthProtocols } from '@/lib/sat'

import { BASE } from '@/lib/base'
const WS_BASE = BASE.replace(/^http/, 'ws')

// ─── Controller-connection registry ────────────────────────────────────────────
//
// The full mixer connection (this hook) and the session-level keep-alive
// (useSessionKeepAlive) must never both hold a socket for the same production —
// that would double the controller-subscriber count for no benefit. This
// module-level registry lets the session keep-alive detect when a full mixer
// connection is already live for a production and stand down accordingly (#139).
const activeControllerProductions = new Map<string, number>()
const registryListeners = new Set<() => void>()

function notifyRegistry() {
  for (const listener of registryListeners) listener()
}

/** Increment the live-connection refcount for a production and notify listeners. */
function acquireControllerConnection(productionId: string) {
  activeControllerProductions.set(productionId, (activeControllerProductions.get(productionId) ?? 0) + 1)
  notifyRegistry()
}

/** Decrement the refcount; drop the key at zero and notify listeners. */
function releaseControllerConnection(productionId: string) {
  const next = (activeControllerProductions.get(productionId) ?? 0) - 1
  if (next <= 0) activeControllerProductions.delete(productionId)
  else activeControllerProductions.set(productionId, next)
  notifyRegistry()
}

/** True when a full mixer controller connection is currently held for `productionId`. */
export function hasControllerConnection(productionId: string): boolean {
  return (activeControllerProductions.get(productionId) ?? 0) > 0
}

/**
 * Subscribe to registry changes. Returns an unsubscribe function. Used by the
 * session-level keep-alive to re-evaluate whether it still needs to hold its own
 * subscription whenever a mixer connection opens or closes.
 */
export function subscribeControllerRegistry(listener: () => void): () => void {
  registryListeners.add(listener)
  return () => { registryListeners.delete(listener) }
}

// Reconnect uses exponential backoff, capped, and — critically — never gives up
// permanently (#130). A present operator whose tab was briefly backgrounded must
// not be silently counted as absent because the client stopped reconnecting.
const WS_RECONNECT_BASE_DELAY_MS = 1000
const WS_RECONNECT_MAX_DELAY_MS = 15000

// Tag for the persistent connection toast, so it upserts (never stacks) and
// can be cleared on a successful (re)connect.
const WS_TOAST_TAG = 'controller-ws'
const SESSION_EXPIRED_MSG = 'Session expired — reload to sign in'
const CONNECTION_LOST_MSG = 'Controller connection lost — reconnecting…'

export type OutboundMessage =
  | { type: 'CUT'; mixerInput: string; afvRampUpMs?: number; afvRampDownMs?: number }
  | { type: 'TRANSITION'; mixerInput: string; transitionType: string; durationMs?: number; afvRampUpMs?: number; afvRampDownMs?: number }
  | { type: 'TAKE'; pip?: number; transitionType?: string; durationMs?: number; afvRampUpMs?: number; afvRampDownMs?: number }
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
  | { type: 'AFV_RAMP_SET'; rampUpMs: number; rampDownMs: number }
  | { type: 'PFL_SET'; elementId: string; enabled: boolean; volume?: number }
  | { type: 'AFL_SET'; elementId: string; enabled: boolean }
  | { type: 'AUX_SEND_SET'; elementId: string; auxBus: number; level: number; enabled: boolean; pre?: boolean }
  | { type: 'AUX_MASTER_SET'; auxBus: number; volume: number; muted: boolean }
  | { type: 'GRP_SEND_SET'; elementId: string; grpBus: number; level: number; enabled: boolean }
  | { type: 'GRP_MASTER_SET'; grpBus: number; volume: number; muted: boolean }
  | { type: 'MONITOR_SET'; volume: number; muted: boolean }
  | { type: 'SOURCE_OFFSET_SET'; mixerInput: string; offsetMs: number }
  | { type: 'SOURCE_AUDIO_OFFSET_SET'; mixerInput: string; offsetMs: number }
  | { type: 'LOUDNESS_RESET' }
  | { type: 'SELECT_PVW_PIP'; pip: number }
  | { type: 'SET_PIP'; pip: number; bg: number | null; zones: PipZone[]; transforms?: PipTransforms }
  | { type: 'SET_EFFECT'; target: EffectTarget; effect: VideoEffect }
  // Clip cue/play control (epic open-live#206, studio#145). Drives the shipped
  // controller-WS clip commands; the backend broadcasts CLIP_STATE in response.
  | { type: 'CLIP_CUE'; mixerInput: string; clipId?: string }
  | { type: 'CLIP_PLAY'; mixerInput: string }
  | { type: 'CLIP_PAUSE'; mixerInput: string }
  | { type: 'CLIP_STOP'; mixerInput: string }
  | { type: 'CLIP_SEEK'; mixerInput: string; positionMs: number }
  // Guest return-feed mode switch (epic open-live#208, studio#138). Crew command;
  // the backend persists, applies live if the guest is active, and broadcasts
  // RETURN_STATE. Only 'program' / 'program-minus' are valid (low-latency-minus is
  // a client-side feed choice, after v1). See docs/specs/guest-calling-intercom.md.
  | { type: 'RETURN_SET'; mixerInput: string; mode: 'program' | 'program-minus' }
  // Explicit "keep this production alive" signal that resets the backend idle
  // timer and cancels a pending idle-timeout warning (#130). Paired backend work
  // (open-live#290) defines the exact handshake; KEEP_ALIVE follows the existing
  // UPPER_SNAKE convention and is the reasonable name until #290 finalises it.
  | { type: 'KEEP_ALIVE' }

/**
 * Opens a WebSocket connection to /ws/productions/:id/controller.
 * Syncs server-side tally state into the production store.
 * Reconnects automatically on close with a 2 s delay.
 * Returns a stable `send` function for dispatching controller messages.
 */
export function useControllerWs(productionId: string | null): (msg: OutboundMessage) => void {
  const wsRef = useRef<WebSocket | null>(null)

  // Gather all store actions once per render and keep them in a ref so the
  // effect closure always sees current values without needing them in deps.
  const setPgm                 = useProductionStore((s) => s.setPgm)
  const setPvw                 = useProductionStore((s) => s.setPvw)
  const setTBarPosition        = useProductionStore((s) => s.setTBarPosition)
  const setDskState            = useProductionStore((s) => s.setDskState)
  const applyLevel             = useAudioStore((s) => s.applyLevel)
  const applyMuted             = useAudioStore((s) => s.applyMuted)
  const applyAfvByMixerInput   = useAudioStore((s) => s.applyAfvByMixerInput)
  const applyPfl               = useAudioStore((s) => s.applyPfl)
  const applyAfl               = useAudioStore((s) => s.applyAfl)
  const applyAuxSend           = useAudioStore((s) => s.applyAuxSend)
  const applyAuxSendPre        = useAudioStore((s) => s.applyAuxSendPre)
  const applyAuxMaster         = useAudioStore((s) => s.applyAuxMaster)
  const applyGrpSend           = useAudioStore((s) => s.applyGrpSend)
  const applyGrpMaster         = useAudioStore((s) => s.applyGrpMaster)
  const applyMonitorMaster     = useAudioStore((s) => s.applyMonitorMaster)
  const resetGrpState          = useAudioStore((s) => s.resetGrpState)
  const applyMeter             = useAudioStore((s) => s.applyMeter)
  const applyLoudness          = useAudioStore((s) => s.applyLoudness)
  const applySourceOffset      = useProductionStore((s) => s.applySourceOffset)
  const applySourceAudioOffset = useProductionStore((s) => s.applySourceAudioOffset)
  const resetSourceOffsets     = useProductionStore((s) => s.resetSourceOffsets)
  const applyAfvRamp           = useProductionStore((s) => s.applyAfvRamp)
  const applyPipState          = useProductionStore((s) => s.applyPipState)
  const applyFxState              = useProductionStore((s) => s.applyFxState)
  const applyClipState            = useProductionStore((s) => s.applyClipState)
  const setDeactivated            = useProductionStore((s) => s.setDeactivated)
  const setIdleWarning            = useProductionStore((s) => s.setIdleWarning)
  const addToast                  = useToastStore((s) => s.addToast)
  const upsertToastByTag          = useToastStore((s) => s.upsertToastByTag)
  const removeToastsByTag         = useToastStore((s) => s.removeToastsByTag)
  const markInactive              = useProductionsStore((s) => s.markInactive)
  const applyGuestState           = useGuestsStore((s) => s.applyGuestState)
  const applyReturnState          = useGuestsStore((s) => s.applyReturnState)

  const actionsRef = useRef({
    setPgm, setPvw, setTBarPosition, setDskState,
    applyLevel, applyMuted, applyAfvByMixerInput,
    applyPfl, applyAfl,
    applyAuxSend, applyAuxSendPre, applyAuxMaster,
    applyGrpSend, applyGrpMaster, applyMonitorMaster, resetGrpState,
    applyMeter, applyLoudness,
    applySourceOffset, applySourceAudioOffset, resetSourceOffsets, applyAfvRamp,
    applyPipState, applyFxState, applyClipState, setDeactivated, setIdleWarning, addToast,
    upsertToastByTag, removeToastsByTag, markInactive,
    applyGuestState, applyReturnState,
  })
  actionsRef.current = {
    setPgm, setPvw, setTBarPosition, setDskState,
    applyLevel, applyMuted, applyAfvByMixerInput,
    applyPfl, applyAfl,
    applyAuxSend, applyAuxSendPre, applyAuxMaster,
    applyGrpSend, applyGrpMaster, applyMonitorMaster, resetGrpState,
    applyMeter, applyLoudness,
    applySourceOffset, applySourceAudioOffset, resetSourceOffsets, applyAfvRamp,
    applyPipState, applyFxState, applyClipState, setDeactivated, setIdleWarning, addToast,
    upsertToastByTag, removeToastsByTag, markInactive,
    applyGuestState, applyReturnState,
  }

  useEffect(() => {
    if (!productionId) return

    // Announce to the registry that a full mixer connection is held for this
    // production for the lifetime of this effect, so the session-level
    // keep-alive stands down and we never double the subscriber count (#139).
    acquireControllerConnection(productionId)

    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectCount = 0
    // Whether the current socket ever reached OPEN. A close *without* a prior
    // open is how a rejected upgrade (e.g. the OSC reverse proxy answering the
    // handshake with HTTP 401) surfaces to the browser — the status code is
    // not readable client-side, but "never opened" is a strong auth-failure
    // signal, since a genuine network drop of an established connection would
    // have opened first.
    let everOpened = false

    const connect = async () => {
      if (cancelled) return

      const token = await getApiToken().catch(() => undefined)
      const wsUrl = new URL(`${WS_BASE}/ws/productions/${productionId}/controller`)

      everOpened = false
      // The SAT travels as a WS subprotocol (osc.bearer.<token>), not a
      // ?token= query param — the OSC ingress gate has never accepted the
      // latter on a WS upgrade (issue #144). See lib/sat.ts.
      const ws = new WebSocket(wsUrl.toString(), wsAuthProtocols(token))
      wsRef.current = ws

      ws.onopen = () => {
        everOpened = true
        // A healthy connection resets the backoff so the next drop starts fast.
        reconnectCount = 0
        // A successful (re)connect clears any stale connection warning.
        actionsRef.current.removeToastsByTag(WS_TOAST_TAG)
      }

      ws.onmessage = (event) => {
        const a = actionsRef.current
        try {
          const msg = JSON.parse(event.data as string) as Record<string, unknown>
          switch (msg['type']) {
            case 'TALLY':
              if (typeof msg['pgm'] === 'string' || msg['pgm'] === null) {
                a.setPgm(msg['pgm'] as string)
              }
              if (typeof msg['pvw'] === 'string' || msg['pvw'] === null) {
                a.setPvw(msg['pvw'] as string)
              }
              break
            case 'OVL_STATE':
              if (typeof msg['alpha'] === 'number') {
                a.setTBarPosition(msg['alpha'] as number)
              }
              break
            case 'DSK_STATE':
              if (typeof msg['layer'] === 'number' && typeof msg['visible'] === 'boolean') {
                a.setDskState(msg['layer'] as number, msg['visible'] as boolean)
              }
              break
            case 'AUDIO_STATE':
              if (typeof msg['elementId'] === 'string') {
                if (msg['property'] === 'volume' && typeof msg['value'] === 'number') {
                  a.applyLevel(msg['elementId'] as string, msg['value'] as number)
                } else if (msg['property'] === 'mute' && typeof msg['value'] === 'boolean') {
                  a.applyMuted(msg['elementId'] as string, msg['value'] as boolean)
                }
              }
              break
            case 'AFV_STATE': {
              if (typeof msg['mixerInput'] === 'string' && typeof msg['enabled'] === 'boolean') {
                a.applyAfvByMixerInput(msg['mixerInput'] as string, msg['enabled'] as boolean)
              }
              break
            }
            case 'PFL_STATE': {
              if (typeof msg['elementId'] === 'string' && typeof msg['enabled'] === 'boolean') {
                a.applyPfl(msg['elementId'] as string, msg['enabled'] as boolean)
              }
              break
            }
            case 'AFL_STATE': {
              if (typeof msg['elementId'] === 'string' && typeof msg['enabled'] === 'boolean') {
                a.applyAfl(msg['elementId'] as string, msg['enabled'] as boolean)
              }
              break
            }
            case 'AUX_SEND_STATE': {
              if (typeof msg['elementId'] === 'string' && typeof msg['auxBus'] === 'number' && typeof msg['level'] === 'number' && typeof msg['enabled'] === 'boolean') {
                a.applyAuxSend(msg['elementId'] as string, msg['auxBus'] as number, msg['level'] as number, msg['enabled'] as boolean)
                if (typeof msg['pre'] === 'boolean') {
                  a.applyAuxSendPre(msg['elementId'] as string, msg['auxBus'] as number, msg['pre'] as boolean)
                }
              }
              break
            }
            case 'AUX_MASTER_STATE': {
              if (typeof msg['auxBus'] === 'number' && typeof msg['volume'] === 'number' && typeof msg['muted'] === 'boolean') {
                a.applyAuxMaster(msg['auxBus'] as number, msg['volume'] as number, msg['muted'] as boolean)
              }
              break
            }
            case 'GRP_STATE_RESET': {
              a.resetGrpState()
              break
            }
            case 'GRP_SEND_STATE': {
              if (typeof msg['elementId'] === 'string' && typeof msg['grpBus'] === 'number' && typeof msg['level'] === 'number' && typeof msg['enabled'] === 'boolean') {
                a.applyGrpSend(msg['elementId'] as string, msg['grpBus'] as number, msg['level'] as number, msg['enabled'] as boolean)
              }
              break
            }
            case 'GRP_MASTER_STATE': {
              if (typeof msg['grpBus'] === 'number' && typeof msg['volume'] === 'number' && typeof msg['muted'] === 'boolean') {
                a.applyGrpMaster(msg['grpBus'] as number, msg['volume'] as number, msg['muted'] as boolean)
              }
              break
            }
            case 'MONITOR_STATE': {
              if (typeof msg['volume'] === 'number' && typeof msg['muted'] === 'boolean') {
                a.applyMonitorMaster(msg['volume'] as number, msg['muted'] as boolean)
              }
              break
            }
            case 'SOURCE_OFFSET_STATE': {
              if (typeof msg['mixerInput'] === 'string' && typeof msg['offsetMs'] === 'number') {
                a.applySourceOffset(msg['mixerInput'] as string, msg['offsetMs'] as number)
              }
              break
            }
            case 'SOURCE_AUDIO_OFFSET_STATE': {
              if (typeof msg['mixerInput'] === 'string' && typeof msg['offsetMs'] === 'number') {
                a.applySourceAudioOffset(msg['mixerInput'] as string, msg['offsetMs'] as number)
              }
              break
            }
            case 'AFV_RAMP_STATE': {
              if (typeof msg['rampUpMs'] === 'number' && typeof msg['rampDownMs'] === 'number') {
                a.applyAfvRamp(msg['rampUpMs'] as number, msg['rampDownMs'] as number)
              }
              break
            }
            case 'METER_DATA':
              if (typeof msg['elementId'] === 'string' && Array.isArray(msg['peak']) && Array.isArray(msg['rms'])) {
                a.applyMeter(msg['elementId'] as string, msg['peak'] as number[], msg['rms'] as number[])
              }
              break
            case 'LOUDNESS_DATA':
              if (typeof msg['elementId'] === 'string' && typeof msg['momentary'] === 'number') {
                a.applyLoudness(
                  msg['elementId'] as string,
                  msg['momentary'] as number,
                  typeof msg['shortterm'] === 'number' ? msg['shortterm'] as number : null,
                  typeof msg['integrated'] === 'number' ? msg['integrated'] as number : null,
                  Array.isArray(msg['true_peak']) ? msg['true_peak'] as number[] : [],
                )
              }
              break
            case 'PIP_STATE':
              a.applyPipState(
                typeof msg['pgmPip'] === 'number' ? msg['pgmPip'] as number : null,
                typeof msg['pvwPip'] === 'number' ? msg['pvwPip'] as number : null,
                Array.isArray(msg['pips']) ? msg['pips'] as PipConfig[] : [],
              )
              break
            case 'FX_STATE':
              if (typeof msg['fxAvailable'] === 'boolean' && Array.isArray(msg['inputEffects']) && msg['masterEffect'] !== null && typeof msg['masterEffect'] === 'object') {
                a.applyFxState(
                  msg['fxAvailable'] as boolean,
                  msg['inputEffects'] as VideoEffect[],
                  msg['masterEffect'] as VideoEffect,
                )
              }
              break
            case 'CLIP_STATE': {
              // Live clip playback state (epic open-live#206, studio#145). The
              // backend spreads a ClipState onto the frame, so fields sit at the
              // top level. mixerInput + state are required; the rest are optional.
              const validStates = ['idle', 'cued', 'playing', 'paused', 'stopped', 'completed', 'error']
              if (typeof msg['mixerInput'] === 'string' && typeof msg['state'] === 'string' && validStates.includes(msg['state'] as string)) {
                a.applyClipState({
                  mixerInput: msg['mixerInput'] as string,
                  state: msg['state'] as ClipState['state'],
                  ...(typeof msg['clipId'] === 'string' ? { clipId: msg['clipId'] as string } : {}),
                  ...(typeof msg['positionMs'] === 'number' ? { positionMs: msg['positionMs'] as number } : {}),
                  ...(typeof msg['durationMs'] === 'number' ? { durationMs: msg['durationMs'] as number } : {}),
                  ...(typeof msg['error'] === 'string' ? { error: msg['error'] as string } : {}),
                })
              }
              break
            }
            case 'GUEST_STATE': {
              // Guest lifecycle broadcast (epic open-live#208, studio#138). Included
              // in the connect-time sync and pushed on every state change.
              // Shape: { guestId, mixerInput, state, label?, intercomLine? }.
              const validStates: GuestState[] = ['invited', 'joined', 'previewing', 'on-air', 'left', 'error']
              if (
                typeof msg['guestId'] === 'string' &&
                typeof msg['mixerInput'] === 'string' &&
                typeof msg['state'] === 'string' &&
                (validStates as string[]).includes(msg['state'] as string)
              ) {
                // The backend emits `intercomLine` as the intercom line id
                // (a plain string), not an object — accept a non-empty string.
                const intercomLine =
                  typeof msg['intercomLine'] === 'string' && msg['intercomLine'].length > 0
                    ? (msg['intercomLine'] as string)
                    : undefined
                a.applyGuestState({
                  guestId: msg['guestId'] as string,
                  mixerInput: msg['mixerInput'] as string,
                  state: msg['state'] as GuestState,
                  ...(typeof msg['label'] === 'string' ? { label: msg['label'] as string } : {}),
                  ...(intercomLine ? { intercomLine } : {}),
                })
              }
              break
            }
            case 'RETURN_STATE': {
              // Guest return-feed mode broadcast (epic open-live#208, studio#138).
              // Shape: { mixerInput, mode } with mode ∈ 'program' | 'program-minus'.
              if (
                typeof msg['mixerInput'] === 'string' &&
                (msg['mode'] === 'program' || msg['mode'] === 'program-minus')
              ) {
                a.applyReturnState(msg['mixerInput'] as string, msg['mode'] as ReturnMode)
              }
              break
            }
            case 'IDLE_WARNING': {
              // Pre-deactivation idle-timeout warning from the backend (#130,
              // paired with open-live#290). The backend message contract may
              // still be in flight, so accept the countdown defensively under
              // several plausible field names and derive a wall-clock deadline:
              //   - deadlineMs / deadline: absolute epoch ms
              //   - remainingMs:           ms until deactivation
              //   - remainingSec:          seconds until deactivation
              // If none is present, fall back to the existing idle deadline
              // (idleExpiresAt) already tracked per-production on the REST model.
              let deadlineMs: number | null = null
              if (typeof msg['deadlineMs'] === 'number') deadlineMs = msg['deadlineMs'] as number
              else if (typeof msg['deadline'] === 'number') deadlineMs = msg['deadline'] as number
              else if (typeof msg['remainingMs'] === 'number') deadlineMs = Date.now() + (msg['remainingMs'] as number)
              else if (typeof msg['remainingSec'] === 'number') deadlineMs = Date.now() + (msg['remainingSec'] as number) * 1000
              if (deadlineMs !== null) a.setIdleWarning({ deadlineMs })
              break
            }
            case 'IDLE_WARNING_CLEARED':
              // Backend confirmed the idle timer was reset (e.g. via KEEP_ALIVE
              // or renewed activity); dismiss the mixer-view warning.
              a.setIdleWarning(null)
              break
            case 'PRODUCTION_DEACTIVATED': {
              if (productionId) a.markInactive(productionId)
              a.resetSourceOffsets()
              // Attribute the deactivation correctly (#130): an idle auto-timeout
              // must NOT be reported as "deactivated by another user". The backend
              // marks idle teardown with endedReason: 'idle' / autoDeactivated;
              // accept either signal defensively across a few field names.
              const reasonField = msg['reason'] ?? msg['endedReason']
              const isIdle = reasonField === 'idle' || msg['autoDeactivated'] === true
              a.setDeactivated(isIdle ? 'idle' : 'external')
              break
            }
            case 'ERROR':
              if (typeof msg['error'] === 'string') {
                a.addToast(msg['error'])
              }
              break
          }
        } catch {
          // ignore malformed frames
        }
      }

      ws.onerror = () => {
        // Connection errors are silent — onclose will fire next and schedule reconnect
      }

      ws.onclose = () => {
        wsRef.current = null
        if (cancelled) return

        const a = actionsRef.current
        const showSessionToast = (message: string) => {
          a.upsertToastByTag(WS_TOAST_TAG, message, 'error', { persistent: true })
        }

        // Fail fast on a likely auth failure: the socket closed without ever
        // opening, which is how the OSC proxy's 401 on the upgrade appears
        // client-side. Retrying will never succeed while the session cookie is
        // expired, so surface the session-expired message immediately instead
        // of burning the silent backoff/retry budget.
        if (!everOpened) {
          showSessionToast(SESSION_EXPIRED_MSG)
          return
        }

        // A previously-healthy connection dropped. Keep retrying indefinitely
        // with capped exponential backoff (#130) — never give up permanently, so
        // a present operator whose tab was backgrounded is not silently treated
        // as absent. Surface a non-alarming "reconnecting" notice meanwhile; a
        // successful reconnect clears it in onopen.
        showSessionToast(CONNECTION_LOST_MSG)
        const delay = Math.min(
          WS_RECONNECT_BASE_DELAY_MS * 2 ** reconnectCount,
          WS_RECONNECT_MAX_DELAY_MS,
        )
        reconnectCount++
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    // Reconnect promptly when the operator returns to the tab or the network
    // comes back, rather than waiting out the current backoff delay. This is the
    // key recovery path for the reported scenario: the tab was backgrounded, the
    // socket dropped, and refocusing must re-establish the connection (#130).
    const reconnectNow = () => {
      if (cancelled) return
      if (wsRef.current) return // already connected or connecting
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      reconnectCount = 0
      void connect()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconnectNow()
    }
    window.addEventListener('online', reconnectNow)
    window.addEventListener('focus', reconnectNow)
    document.addEventListener('visibilitychange', onVisibility)

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      window.removeEventListener('online', reconnectNow)
      window.removeEventListener('focus', reconnectNow)
      document.removeEventListener('visibilitychange', onVisibility)
      wsRef.current?.close()
      wsRef.current = null
      // Release the registry entry so the session-level keep-alive takes over
      // once the mixer view has unmounted (#139).
      releaseControllerConnection(productionId)
      // Clear any connection warning we raised so it doesn't linger after the
      // hook unmounts (e.g. navigating away from the production).
      actionsRef.current.removeToastsByTag(WS_TOAST_TAG)
    }
  }, [productionId])

  const send = useCallback((msg: OutboundMessage) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }, [])

  return send
}
