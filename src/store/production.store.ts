import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import { useAudioStore } from './audio.store.js'
import { usePipelineStore } from './pipeline.store.js'

export type TransitionType = 'fade' | 'slide_left' | 'slide_right' | 'slide_up' | 'slide_down'

interface ProductionState {
  /** Active mixer input on program, e.g. "video_in_0" */
  pgmInput: string | null
  /** Active mixer input on preview */
  pvwInput: string | null
  isFtb: boolean
  transitionType: TransitionType
  transitionDurationMs: number
  tBarPosition: number // 0.0–1.0
  activeProductionId: string | null
  /** Server-confirmed DSK layer visibility: layer index → visible */
  dskState: Record<number, boolean>
}

interface ProductionActions {
  cut: () => void
  auto: () => void
  ftb: () => void
  setPvw: (mixerInput: string) => void
  setPgm: (mixerInput: string) => void
  setTransitionType: (type: TransitionType) => void
  setTransitionDuration: (ms: number) => void
  setTBarPosition: (pos: number) => void
  setActiveProduction: (id: string | null) => void
  setDskState: (layer: number, visible: boolean) => void
}

export const useProductionStore = create<ProductionState & ProductionActions>()(
  devtools(
    immer((set) => ({
      // State
      pgmInput: null,
      pvwInput: null,
      isFtb: false,
      transitionType: 'fade',
      transitionDurationMs: 1000,
      tBarPosition: 1,
      activeProductionId: null,
      dskState: {},

      // Actions
      cut: () =>
        set((state) => {
          const temp = state.pgmInput
          state.pgmInput = state.pvwInput
          state.pvwInput = temp
          state.isFtb = false
        }),

      auto: () =>
        set((state) => {
          const temp = state.pgmInput
          state.pgmInput = state.pvwInput
          state.pvwInput = temp
          state.isFtb = false
        }),

      ftb: () =>
        set((state) => {
          state.isFtb = !state.isFtb
        }),

      setPvw: (mixerInput) =>
        set((state) => {
          state.pvwInput = mixerInput
        }),

      setPgm: (mixerInput) =>
        set((state) => {
          state.pgmInput = mixerInput
        }),

      setTransitionType: (type) =>
        set((state) => {
          state.transitionType = type
        }),

      setTransitionDuration: (ms) =>
        set((state) => {
          state.transitionDurationMs = ms
        }),

      setTBarPosition: (pos) =>
        set((state) => {
          state.tBarPosition = Math.max(0, Math.min(1, pos))
        }),

      setActiveProduction: (id) => {
        set((state) => {
          state.activeProductionId = id
          state.pgmInput = null
          state.pvwInput = null
          state.isFtb = false
          state.tBarPosition = 1
          state.dskState = {}
        })
        // Clear audio strips synchronously so the new production never renders with
        // a previous production's elements. React 18 batches these two store updates
        // into one render, so the user never sees stale strips.
        useAudioStore.setState({ elements: [], productionId: id ?? null, levels: {}, muted: {}, meters: {} })
        // Clear pipeline runtime state
        usePipelineStore.setState({ stromJson: '', executionState: 'idle', uptimeSeconds: 0, parseError: null })
      },

      setDskState: (layer, visible) =>
        set((state) => {
          state.dskState[layer] = visible
        }),
    })),
    { name: 'production' },
  ),
)
