import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import type { ApiAudioElement } from '@/lib/api'

interface MeterReading { peak: number[]; rms: number[]; decay?: number[] }

interface AudioState {
  elements: ApiAudioElement[]
  levels: Record<string, number>        // elementId → 0.0–1.0
  muted: Record<string, boolean>        // elementId → boolean
  meters: Record<string, MeterReading>  // elementId → peak/rms in dB
  productionId: string | null
}

interface AudioActions {
  setElements: (elements: ApiAudioElement[], productionId: string) => void
  // Pure setters called by the WS handler when the server broadcasts state
  applyLevel: (elementId: string, value: number) => void
  applyMuted: (elementId: string, muted: boolean) => void
  applyMeter: (elementId: string, peak: number[], rms: number[]) => void
  // Optimistic local-only updates called by the UI before sending via WS
  setLevel: (elementId: string, value: number) => void
  toggleMute: (elementId: string) => void
}

export const useAudioStore = create<AudioState & AudioActions>()(
  devtools(
    immer((_set, get) => ({
      elements: [],
      levels: {},
      muted: {},
      meters: {},
      productionId: null,

      setElements: (elements, productionId) =>
        _set((s) => {
          if (s.productionId !== productionId) {
            s.levels = {}
            s.muted = {}
            s.meters = {}
          }
          s.elements = elements
          s.productionId = productionId
          elements.forEach((el) => {
            if (s.levels[el.elementId] === undefined) s.levels[el.elementId] = 1.0
            if (s.muted[el.elementId] === undefined) s.muted[el.elementId] = false
          })
        }),

      applyLevel: (elementId, value) =>
        _set((s) => { s.levels[elementId] = Math.max(0, Math.min(1, value)) }),

      applyMuted: (elementId, muted) =>
        _set((s) => { s.muted[elementId] = muted }),

      applyMeter: (elementId, peak, rms) =>
        _set((s) => { s.meters[elementId] = { peak, rms } }),

      setLevel: (elementId, value) =>
        _set((s) => { s.levels[elementId] = Math.max(0, Math.min(1, value)) }),

      toggleMute: (elementId) => {
        _set((s) => { s.muted[elementId] = !s.muted[elementId] })
        return get().muted[elementId]
      },
    })),
    { name: 'audio' },
  ),
)
