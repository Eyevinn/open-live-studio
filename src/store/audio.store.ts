import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import type { ApiAudioElement } from '@/lib/api'

interface MeterReading { peak: number[]; rms: number[]; decay?: number[] }

interface AudioState {
  elements: ApiAudioElement[]
  levels: Record<string, number>                       // elementId → 0.0–10.0 (linear amplitude; 1.0 = 0 dB, 10.0 = +20 dB)
  muted: Record<string, boolean>                       // elementId → boolean
  afv: Record<string, boolean>                         // elementId → AFV enabled (input channels only)
  pfl: Record<string, boolean>                         // elementId → PFL send enabled (input channels only)
  auxSend: Record<string, Record<number, number>>      // elementId → auxBus(1-indexed) → fader level (0–10); preserved across ON/OFF
  auxSendEnabled: Record<string, Record<number, boolean>> // elementId → auxBus(1-indexed) → send routed to bus
  auxMasterLevel: Record<number, number>               // auxBus(1-indexed) → fader level (0–10); 1.0 = 0 dB default
  auxMasterMuted: Record<number, boolean>              // auxBus(1-indexed) → master muted (output silenced)
  grpSend: Record<string, Record<number, number>>      // elementId → grpBus(1-indexed) → fader level (0–10); preserved across ON/OFF
  grpSendEnabled: Record<string, Record<number, boolean>> // elementId → grpBus(1-indexed) → send routed to bus
  grpMasterLevel: Record<number, number>               // grpBus(1-indexed) → fader level (0–10); 1.0 = 0 dB default
  grpMasterMuted: Record<number, boolean>              // grpBus(1-indexed) → master muted (output silenced)
  meters: Record<string, MeterReading>                 // elementId → peak/rms in dB
  pendingAfvByMixerInput: Record<string, boolean>      // mixerInput → AFV queued before elements loaded
  productionId: string | null
}

interface AudioActions {
  setElements: (elements: ApiAudioElement[], productionId: string) => void
  // Pure setters called by the WS handler when the server broadcasts state
  applyLevel: (elementId: string, value: number) => void
  applyMuted: (elementId: string, muted: boolean) => void
  /** Server-authoritative AFV setter. Keyed by mixerInput so it works even when
   *  elements haven't loaded yet — the value is queued and applied by setElements. */
  applyAfvByMixerInput: (mixerInput: string, enabled: boolean) => void
  /** Server-authoritative PFL setter — syncs across all connected operator clients. */
  applyPfl: (elementId: string, enabled: boolean) => void
  /** Server-authoritative AUX per-channel send setter.
   *  level = fader position (0–10); enabled = whether send is routed. */
  applyAuxSend: (elementId: string, auxBus: number, level: number, enabled: boolean) => void
  /** Server-authoritative AUX bus master setter.
   *  volume = fader level (0–10); muted = whether output is silenced. */
  applyAuxMaster: (auxBus: number, volume: number, muted: boolean) => void
  /** Server-authoritative GRP per-channel send setter.
   *  level = fader position (0–10); enabled = whether send is routed. */
  applyGrpSend: (elementId: string, grpBus: number, level: number, enabled: boolean) => void
  /** Server-authoritative GRP bus master setter.
   *  volume = fader level (0–10); muted = whether output is silenced. */
  applyGrpMaster: (grpBus: number, volume: number, muted: boolean) => void
  applyMeter: (elementId: string, peak: number[], rms: number[]) => void
  // Optimistic local-only updates called by the UI before sending via WS
  setLevel: (elementId: string, value: number) => void
  /** Update the fader level for an aux send (does not change enabled state). */
  setAuxSend: (elementId: string, auxBus: number, level: number) => void
  /** Toggle the ON/OFF state of an aux send without touching the fader level. */
  setAuxSendEnabled: (elementId: string, auxBus: number, enabled: boolean) => void
  /** Update the fader level for an AUX bus master (does not change muted state). */
  setAuxMasterLevel: (auxBus: number, level: number) => void
  /** Toggle the muted state of an AUX bus master without touching the fader level. */
  setAuxMasterMuted: (auxBus: number, muted: boolean) => void
  /** Update the fader level for a GRP send (does not change enabled state). */
  setGrpSend: (elementId: string, grpBus: number, level: number) => void
  /** Toggle the ON/OFF state of a GRP send without touching the fader level. */
  setGrpSendEnabled: (elementId: string, grpBus: number, enabled: boolean) => void
  /** Update the fader level for a GRP bus master (does not change muted state). */
  setGrpMasterLevel: (grpBus: number, level: number) => void
  /** Toggle the muted state of a GRP bus master without touching the fader level. */
  setGrpMasterMuted: (grpBus: number, muted: boolean) => void
  toggleMute: (elementId: string) => void
  toggleAfv: (elementId: string) => void
  togglePfl: (elementId: string) => void
}

export const useAudioStore = create<AudioState & AudioActions>()(
  devtools(
    immer((_set, get) => ({
      elements: [],
      levels: {},
      muted: {},
      afv: {},
      pfl: {},
      auxSend: {},
      auxSendEnabled: {},
      auxMasterLevel: {},
      auxMasterMuted: {},
      grpSend: {},
      grpSendEnabled: {},
      grpMasterLevel: {},
      grpMasterMuted: {},
      meters: {},
      pendingAfvByMixerInput: {},
      productionId: null,

      setElements: (elements, productionId) =>
        _set((s) => {
          if (s.productionId !== productionId) {
            s.levels = {}
            s.muted = {}
            s.afv = {}
            s.pfl = {}
            s.auxSend = {}
            s.auxSendEnabled = {}
            s.auxMasterLevel = {}
            s.auxMasterMuted = {}
            s.grpSend = {}
            s.grpSendEnabled = {}
            s.grpMasterLevel = {}
            s.grpMasterMuted = {}
            s.meters = {}
            s.pendingAfvByMixerInput = {}
          }
          s.elements = elements
          s.productionId = productionId
          elements.forEach((el) => {
            if (s.levels[el.elementId] === undefined) s.levels[el.elementId] = 1.0
            if (s.muted[el.elementId] === undefined) s.muted[el.elementId] = false
            if (s.pfl[el.elementId] === undefined) s.pfl[el.elementId] = false
            // Always reset AFV from the pending queue or to false.
            // No `=== undefined` guard — this ensures stale AFV state from a
            // previous session is cleared when the backend resets its registry
            // (pipeline restart, source remap). AFV_STATE messages that arrive
            // after setElements are applied directly via applyAfvByMixerInput.
            const key = el.mixerInput ?? ''
            if (key && s.pendingAfvByMixerInput[key] !== undefined) {
              s.afv[el.elementId] = s.pendingAfvByMixerInput[key]
              delete s.pendingAfvByMixerInput[key]
            } else {
              s.afv[el.elementId] = false
            }
          })
        }),

      applyLevel: (elementId, value) =>
        _set((s) => { s.levels[elementId] = Math.max(0, Math.min(10, value)) }),

      applyMuted: (elementId, muted) =>
        _set((s) => { s.muted[elementId] = muted }),

      applyAfvByMixerInput: (mixerInput, enabled) => {
        const elements = get().elements
        const el = elements.find((e) => e.mixerInput === mixerInput)
        if (el) {
          _set((s) => { s.afv[el.elementId] = enabled })
        } else {
          // Elements not loaded yet — queue and drain in setElements
          _set((s) => { s.pendingAfvByMixerInput[mixerInput] = enabled })
        }
      },

      applyMeter: (elementId, peak, rms) =>
        _set((s) => { s.meters[elementId] = { peak, rms } }),

      setLevel: (elementId, value) =>
        _set((s) => { s.levels[elementId] = Math.max(0, Math.min(10, value)) }),

      toggleMute: (elementId) => {
        _set((s) => { s.muted[elementId] = !s.muted[elementId] })
        return get().muted[elementId]
      },

      toggleAfv: (elementId) =>
        _set((s) => { s.afv[elementId] = !s.afv[elementId] }),

      applyPfl: (elementId, enabled) =>
        _set((s) => { s.pfl[elementId] = enabled }),

      applyAuxSend: (elementId, auxBus, level, enabled) =>
        _set((s) => {
          if (!s.auxSend[elementId]) s.auxSend[elementId] = {}
          if (!s.auxSendEnabled[elementId]) s.auxSendEnabled[elementId] = {}
          s.auxSend[elementId][auxBus] = level
          s.auxSendEnabled[elementId][auxBus] = enabled
        }),

      applyAuxMaster: (auxBus, volume, muted) =>
        _set((s) => {
          // Always update the fader position so all clients stay in sync,
          // even when the master is muted (fader shows saved level).
          s.auxMasterLevel[auxBus] = volume
          s.auxMasterMuted[auxBus] = muted
        }),

      applyGrpSend: (elementId, grpBus, level, enabled) =>
        _set((s) => {
          if (!s.grpSend[elementId]) s.grpSend[elementId] = {}
          if (!s.grpSendEnabled[elementId]) s.grpSendEnabled[elementId] = {}
          s.grpSend[elementId][grpBus] = level
          s.grpSendEnabled[elementId][grpBus] = enabled
        }),

      applyGrpMaster: (grpBus, volume, muted) =>
        _set((s) => {
          // Always update the fader position so all clients stay in sync,
          // even when the master is muted (fader shows saved level).
          s.grpMasterLevel[grpBus] = volume
          s.grpMasterMuted[grpBus] = muted
        }),

      setAuxSend: (elementId, auxBus, level) =>
        _set((s) => {
          if (!s.auxSend[elementId]) s.auxSend[elementId] = {}
          s.auxSend[elementId][auxBus] = level
        }),

      setAuxSendEnabled: (elementId, auxBus, enabled) =>
        _set((s) => {
          if (!s.auxSendEnabled[elementId]) s.auxSendEnabled[elementId] = {}
          s.auxSendEnabled[elementId][auxBus] = enabled
        }),

      setAuxMasterLevel: (auxBus, level) =>
        _set((s) => { s.auxMasterLevel[auxBus] = level }),

      setAuxMasterMuted: (auxBus, muted) =>
        _set((s) => { s.auxMasterMuted[auxBus] = muted }),

      setGrpSend: (elementId, grpBus, level) =>
        _set((s) => {
          if (!s.grpSend[elementId]) s.grpSend[elementId] = {}
          s.grpSend[elementId][grpBus] = level
        }),

      setGrpSendEnabled: (elementId, grpBus, enabled) =>
        _set((s) => {
          if (!s.grpSendEnabled[elementId]) s.grpSendEnabled[elementId] = {}
          s.grpSendEnabled[elementId][grpBus] = enabled
        }),

      setGrpMasterLevel: (grpBus, level) =>
        _set((s) => { s.grpMasterLevel[grpBus] = level }),

      setGrpMasterMuted: (grpBus, muted) =>
        _set((s) => { s.grpMasterMuted[grpBus] = muted }),

      togglePfl: (elementId) =>
        _set((s) => { s.pfl[elementId] = !s.pfl[elementId] }),
    })),
    { name: 'audio' },
  ),
)
