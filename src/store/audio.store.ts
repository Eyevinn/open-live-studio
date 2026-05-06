import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import type { ApiAudioElement } from '@/lib/api'

interface MeterReading { peak: number[]; rms: number[]; decay?: number[] }

interface AudioState {
  elements: ApiAudioElement[]
  levels: Record<string, number>               // elementId → 0.0–10.0 (linear amplitude; 1.0 = 0 dB, 10.0 = +20 dB)
  muted: Record<string, boolean>               // elementId → boolean
  afv: Record<string, boolean>                 // elementId → AFV enabled (input channels only)
  meters: Record<string, MeterReading>         // elementId → peak/rms in dB
  pendingAfvByMixerInput: Record<string, boolean>  // mixerInput → AFV queued before elements loaded
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
  applyMeter: (elementId: string, peak: number[], rms: number[]) => void
  // Optimistic local-only updates called by the UI before sending via WS
  setLevel: (elementId: string, value: number) => void
  toggleMute: (elementId: string) => void
  toggleAfv: (elementId: string) => void
}

export const useAudioStore = create<AudioState & AudioActions>()(
  devtools(
    immer((_set, get) => ({
      elements: [],
      levels: {},
      muted: {},
      afv: {},
      meters: {},
      pendingAfvByMixerInput: {},
      productionId: null,

      setElements: (elements, productionId) =>
        _set((s) => {
          if (s.productionId !== productionId) {
            s.levels = {}
            s.muted = {}
            s.afv = {}
            s.meters = {}
            s.pendingAfvByMixerInput = {}
          }
          s.elements = elements
          s.productionId = productionId
          elements.forEach((el) => {
            if (s.levels[el.elementId] === undefined) s.levels[el.elementId] = 1.0
            if (s.muted[el.elementId] === undefined) s.muted[el.elementId] = false
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
      })),
    { name: 'audio' },
  ),
)
