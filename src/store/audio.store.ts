import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import type { ApiAudioElement } from '@/lib/api'

interface MeterReading {
  peak: number[];
  rms: number[];
  decay?: number[];
  // EBU R128 loudness (LUFS) — populated from LoudnessData events when available
  lufs_m?: number;        // momentary, 400ms window
  lufs_s?: number;        // short-term, 3s window
  lufs_i?: number;        // integrated (programme loudness)
  true_peak?: number[];   // per-channel linear amplitude from Strom (0.0–1.0+); −1 dBTP = 0.891
}

interface AudioState {
  elements: ApiAudioElement[]
  levels: Record<string, number>                       // elementId → 0.0–10.0 (linear amplitude; 1.0 = 0 dB, 10.0 = +20 dB)
  muted: Record<string, boolean>                       // elementId → boolean
  afv: Record<string, boolean>                         // elementId → AFV enabled (input channels only)
  pfl: Record<string, boolean>                         // elementId → PFL send enabled (input channels only)
  afl: Record<string, boolean>                         // elementId → AFL send enabled (input channels only)
  auxSend: Record<string, Record<number, number>>      // elementId → auxBus(1-indexed) → fader level (0–10); preserved across ON/OFF
  auxSendEnabled: Record<string, Record<number, boolean>> // elementId → auxBus(1-indexed) → send routed to bus
  auxSendPre: Record<string, Record<number, boolean>>  // elementId → auxBus(1-indexed) → true = pre-fader, false = post-fader (default)
  auxMasterLevel: Record<number, number>               // auxBus(1-indexed) → fader level (0–10); 1.0 = 0 dB default
  auxMasterMuted: Record<number, boolean>              // auxBus(1-indexed) → master muted (output silenced)
  monitorLevel: number                                 // monitor_out master fader level (0–10); 1.0 = 0 dB default
  monitorMuted: boolean                                // monitor_out master muted (operator's listening level)
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
  /** Optimistic live guest strip label (open-live#522). Sets the invite `name`
   *  on the matching strip immediately on a guest join so the operator sees it
   *  without a reload. This is a responsiveness-only hint: the authoritative
   *  label — including the correct "Guest N" revert on leave/kick/revoke, which
   *  the server numbers by pad-index rank — always arrives via a `/audio`
   *  re-fetch through `applyElementLabels`, so this never guesses a revert label. */
  applyGuestLabelByMixerInput: (mixerInput: string, name: string) => void
  /** Label-only refresh from a `/audio` re-fetch (open-live#522). Updates ONLY
   *  the `label` of matching strips (matched by `elementId`, falling back to
   *  `mixerInput`), leaving afv/levels/muted/pfl/afl and every other channel
   *  state untouched. The `/audio` payload carries no AFV field, so routing it
   *  through `setElements` would wrongly reset AFV on every strip not in the
   *  pending queue; this does not. No-ops if the production has since changed
   *  (discards a stale in-flight fetch after a production switch). */
  applyElementLabels: (elements: ApiAudioElement[], productionId: string) => void
  /** Server-authoritative PFL setter — syncs across all connected operator clients. */
  applyPfl: (elementId: string, enabled: boolean) => void
  /** Server-authoritative AFL setter — syncs across all connected operator clients. */
  applyAfl: (elementId: string, enabled: boolean) => void
  /** Server-authoritative AUX per-channel send setter.
   *  level = fader position (0–10); enabled = whether send is routed. */
  applyAuxSend: (elementId: string, auxBus: number, level: number, enabled: boolean) => void
  /** Server-authoritative AUX pre/post toggle setter. */
  applyAuxSendPre: (elementId: string, auxBus: number, pre: boolean) => void
  /** Server-authoritative AUX bus master setter.
   *  volume = fader level (0–10); muted = whether output is silenced. */
  applyAuxMaster: (auxBus: number, volume: number, muted: boolean) => void
  /** Server-authoritative monitor bus master setter.
   *  volume = fader level (0–10); muted = whether the operator's monitoring output is silenced.
   *  Has zero effect on the programme mix — local listening level only. */
  applyMonitorMaster: (volume: number, muted: boolean) => void
  /** Server-authoritative GRP per-channel send setter.
   *  level = fader position (0–10); enabled = whether send is routed. */
  applyGrpSend: (elementId: string, grpBus: number, level: number, enabled: boolean) => void
  /** Server-authoritative GRP bus master setter.
   *  volume = fader level (0–10); muted = whether output is silenced. */
  applyGrpMaster: (grpBus: number, volume: number, muted: boolean) => void
  applyMeter: (elementId: string, peak: number[], rms: number[]) => void
  applyLoudness: (elementId: string, lufs_m: number, lufs_s: number | null, lufs_i: number | null, true_peak: number[]) => void
  // Optimistic local-only updates called by the UI before sending via WS
  setLevel: (elementId: string, value: number) => void
  /** Update the fader level for an aux send (does not change enabled state). */
  setAuxSend: (elementId: string, auxBus: number, level: number) => void
  /** Toggle the ON/OFF state of an aux send without touching the fader level. */
  setAuxSendEnabled: (elementId: string, auxBus: number, enabled: boolean) => void
  /** Toggle the pre/post-fader state of an aux send. */
  setAuxSendPre: (elementId: string, auxBus: number, pre: boolean) => void
  /** Update the fader level for an AUX bus master (does not change muted state). */
  setAuxMasterLevel: (auxBus: number, level: number) => void
  /** Toggle the muted state of an AUX bus master without touching the fader level. */
  setAuxMasterMuted: (auxBus: number, muted: boolean) => void
  /** Update the monitor bus master fader level (does not change muted state). */
  setMonitorLevel: (level: number) => void
  /** Toggle the monitor bus master mute without touching the fader level. */
  setMonitorMuted: (muted: boolean) => void
  /** Update the fader level for a GRP send (does not change enabled state). */
  setGrpSend: (elementId: string, grpBus: number, level: number) => void
  /** Toggle the ON/OFF state of a GRP send without touching the fader level. */
  setGrpSendEnabled: (elementId: string, grpBus: number, enabled: boolean) => void
  /** Update the fader level for a GRP bus master (does not change muted state). */
  setGrpMasterLevel: (grpBus: number, level: number) => void
  /** Toggle the muted state of a GRP bus master without touching the fader level. */
  setGrpMasterMuted: (grpBus: number, muted: boolean) => void
  /** Reset all group send assignments — called on production deactivation. */
  resetGrpState: () => void
  /** Reset all aux per-channel send state — called on production (re)connect. */
  resetAuxSendState: () => void
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
      afl: {},
      auxSend: {},
      auxSendEnabled: {},
      auxSendPre: {},
      auxMasterLevel: {},
      auxMasterMuted: {},
      monitorLevel: 1.0,
      monitorMuted: false,
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
            s.afl = {}
            s.auxSend = {}
            s.auxSendEnabled = {}
            s.auxSendPre = {}
            s.auxMasterLevel = {}
            s.auxMasterMuted = {}
            s.monitorLevel = 1.0
            s.monitorMuted = false
            s.grpSend = {}
            s.grpSendEnabled = {}
            s.grpMasterLevel = {}
            s.grpMasterMuted = {}
            s.meters = {}
            s.pendingAfvByMixerInput = {}
          } else if (elements.length === 0) {
            // Same production (re)connecting after deactivation — reset all ephemeral
            // channel state. Master levels are preserved; backend re-broadcasts them.
            s.pfl = {}
            s.afl = {}
            s.auxSend = {}
            s.auxSendEnabled = {}
            s.auxSendPre = {}
          }
          s.elements = elements
          s.productionId = productionId
          // The REST `/audio` payload carries the authoritative strip label
          // (the invite name for a joined named guest, the correctly-numbered
          // "Guest N" otherwise, after open-live#532), so it is applied as-is —
          // the WS handler re-fetches it on every guest transition (open-live#522).
          elements.forEach((el) => {
            if (s.levels[el.elementId] === undefined) s.levels[el.elementId] = 1.0
            if (s.muted[el.elementId] === undefined) s.muted[el.elementId] = false
            if (s.pfl[el.elementId] === undefined) s.pfl[el.elementId] = false
            if (s.afl[el.elementId] === undefined) s.afl[el.elementId] = false
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

      applyGuestLabelByMixerInput: (mixerInput, name) =>
        _set((s) => {
          // Optimistic-only: name the matching strip immediately on a join so
          // the operator does not wait for the `/audio` re-fetch to land. When
          // the strip is not loaded yet there is nothing to show early against,
          // and the re-fetch will carry the name, so this is a no-op then.
          const el = s.elements.find((e) => e.mixerInput === mixerInput)
          if (el && name) el.label = name
        }),

      applyElementLabels: (elements, productionId) =>
        _set((s) => {
          // Label-only refresh (open-live#522). The `/audio` payload is the
          // source of truth for strip labels, but it carries NO AFV/level/mute
          // state, so it must NOT be routed through `setElements` — that resets
          // AFV to false on every strip not in the pending queue, wiping live
          // AFV that only ever arrives via AFV_STATE on connect / operator
          // toggle. Match each existing strip by elementId (falling back to
          // mixerInput) and update ONLY its label. Discard a stale in-flight
          // fetch whose production no longer matches the store (production
          // switched during the debounce window or while the fetch was open).
          if (s.productionId !== productionId) return
          elements.forEach((incoming) => {
            const el =
              s.elements.find((e) => e.elementId === incoming.elementId) ??
              (incoming.mixerInput !== null
                ? s.elements.find((e) => e.mixerInput === incoming.mixerInput)
                : undefined)
            if (el) el.label = incoming.label
          })
        }),

      applyMeter: (elementId, peak, rms) =>
        _set((s) => {
          const prev = s.meters[elementId]
          s.meters[elementId] = {
            peak, rms,
            lufs_m: prev?.lufs_m, lufs_s: prev?.lufs_s, lufs_i: prev?.lufs_i,
            true_peak: prev?.true_peak,
          }
        }),

      applyLoudness: (elementId, lufs_m, lufs_s, lufs_i, true_peak) =>
        _set((s) => {
          const prev = s.meters[elementId] ?? { peak: [], rms: [] }
          s.meters[elementId] = {
            ...prev,
            lufs_m,
            ...(lufs_s !== null && { lufs_s }),
            ...(lufs_i !== null && { lufs_i }),
            true_peak,
          }
        }),

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

      applyAfl: (elementId, enabled) =>
        _set((s) => { s.afl[elementId] = enabled }),

      applyAuxSend: (elementId, auxBus, level, enabled) =>
        _set((s) => {
          if (!s.auxSend[elementId]) s.auxSend[elementId] = {}
          if (!s.auxSendEnabled[elementId]) s.auxSendEnabled[elementId] = {}
          s.auxSend[elementId][auxBus] = level
          s.auxSendEnabled[elementId][auxBus] = enabled
        }),

      applyAuxSendPre: (elementId, auxBus, pre) =>
        _set((s) => {
          if (!s.auxSendPre[elementId]) s.auxSendPre[elementId] = {}
          s.auxSendPre[elementId][auxBus] = pre
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

      applyMonitorMaster: (volume, muted) =>
        _set((s) => {
          s.monitorLevel = volume
          s.monitorMuted = muted
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

      setAuxSendPre: (elementId, auxBus, pre) =>
        _set((s) => {
          if (!s.auxSendPre[elementId]) s.auxSendPre[elementId] = {}
          s.auxSendPre[elementId][auxBus] = pre
        }),

      setAuxMasterLevel: (auxBus, level) =>
        _set((s) => { s.auxMasterLevel[auxBus] = level }),

      setAuxMasterMuted: (auxBus, muted) =>
        _set((s) => { s.auxMasterMuted[auxBus] = muted }),

      setMonitorLevel: (level) =>
        _set((s) => { s.monitorLevel = level }),

      setMonitorMuted: (muted) =>
        _set((s) => { s.monitorMuted = muted }),

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

      resetGrpState: () =>
        _set((s) => { s.grpSend = {}; s.grpSendEnabled = {} }),

      resetAuxSendState: () =>
        _set((s) => { s.auxSend = {}; s.auxSendEnabled = {}; s.auxSendPre = {} }),

      togglePfl: (elementId) =>
        _set((s) => { s.pfl[elementId] = !s.pfl[elementId] }),
    })),
    { name: 'audio', enabled: import.meta.env.DEV },
  ),
)
