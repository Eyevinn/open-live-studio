import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'

export type TransitionType = 'mix' | 'dip' | 'push'

interface ProductionState {
  pgmSourceId: string | null
  pvwSourceId: string | null
  isLive: boolean
  isFtb: boolean
  transitionType: TransitionType
  transitionDurationMs: number
  tBarPosition: number // 0.0–1.0
  activeProductionId: string | null
}

interface ProductionActions {
  cut: () => void
  auto: () => void
  ftb: () => void
  setPvw: (sourceId: string) => void
  setPgm: (sourceId: string) => void
  setTransitionType: (type: TransitionType) => void
  setTransitionDuration: (ms: number) => void
  setTBarPosition: (pos: number) => void
  setLive: (live: boolean) => void
  setActiveProduction: (id: string | null) => void
}

export const useProductionStore = create<ProductionState & ProductionActions>()(
  devtools(
    immer((set) => ({
      // State
      pgmSourceId: null,
      pvwSourceId: null,
      isLive: false,
      isFtb: false,
      transitionType: 'mix',
      transitionDurationMs: 1000,
      tBarPosition: 1,
      activeProductionId: null,

      // Actions
      cut: () =>
        set((state) => {
          const temp = state.pgmSourceId
          state.pgmSourceId = state.pvwSourceId
          state.pvwSourceId = temp
          state.isFtb = false
        }),

      auto: () =>
        set((state) => {
          const temp = state.pgmSourceId
          state.pgmSourceId = state.pvwSourceId
          state.pvwSourceId = temp
          state.tBarPosition = 0
          state.isFtb = false
        }),

      ftb: () =>
        set((state) => {
          state.isFtb = !state.isFtb
        }),

      setPvw: (sourceId) =>
        set((state) => {
          state.pvwSourceId = sourceId
        }),

      setPgm: (sourceId) =>
        set((state) => {
          state.pgmSourceId = sourceId
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

      setLive: (live) =>
        set((state) => {
          state.isLive = live
        }),

      setActiveProduction: (id) =>
        set((state) => {
          state.activeProductionId = id
        }),
    })),
    { name: 'production' },
  ),
)
