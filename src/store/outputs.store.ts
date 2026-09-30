import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import { outputsApi, type ApiOutput, type OutputType, type RtmpDestinationInput } from '@/lib/api'

export type { ApiOutput as Output, OutputType, RtmpDestinationInput }

interface OutputsState {
  outputs: ApiOutput[]
  lastFetchedAt: number
  isLoading: boolean
}

interface OutputsActions {
  fetchAll: () => Promise<void>
  addOutput: (body: { name: string; outputType: OutputType; url?: string; rtmp?: RtmpDestinationInput }) => Promise<ApiOutput>
  updateOutput: (id: string, body: { name?: string; url?: string; rtmp?: RtmpDestinationInput }) => Promise<void>
  removeOutput: (id: string) => Promise<void>
}

export const useOutputsStore = create<OutputsState & OutputsActions>()(
  devtools(
    immer((set) => ({
      outputs: [],
      lastFetchedAt: Date.now(),
      isLoading: false,

      fetchAll: async () => {
        set((state) => { state.isLoading = true })
        try {
          const data = await outputsApi.list()
          set((state) => {
            state.outputs = data
            state.isLoading = false
            state.lastFetchedAt = Date.now()
          })
        } catch {
          set((state) => { state.isLoading = false })
        }
      },

      addOutput: async (body) => {
        const created = await outputsApi.create(body)
        set((state) => { state.outputs.push(created) })
        return created
      },

      updateOutput: async (id, body) => {
        const updated = await outputsApi.update(id, body)
        set((state) => {
          const idx = state.outputs.findIndex((o) => o.id === id)
          if (idx >= 0) state.outputs[idx] = updated
        })
      },

      removeOutput: async (id) => {
        await outputsApi.remove(id)
        set((state) => { state.outputs = state.outputs.filter((o) => o.id !== id) })
      },
    })),
    { name: 'outputs', enabled: import.meta.env.DEV },
  ),
)
