import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import { sourcesApi, type ApiSource, type StreamType } from '@/lib/api'

export type SourceStatus = 'active' | 'inactive'

export interface Source {
  id: string
  name: string
  address: string
  streamType: StreamType
  status: SourceStatus
  color: string
  liveCamera?: boolean
  latency?: number
}

interface SourcesState {
  sources: Source[]
  lastFetchedAt: number
  isLoading: boolean
}

interface SourcesActions {
  fetchAll: () => Promise<void>
  refresh: () => Promise<void>
  addSource: (source: Omit<Source, 'id'>) => Promise<void>
  removeSource: (id: string) => Promise<void>
  updateSource: (id: string, fields: Partial<Pick<Source, 'name' | 'address' | 'latency'>>) => Promise<void>
  updateStatus: (id: string, status: SourceStatus) => Promise<void>
}

const SOURCE_COLOR = '#27272a'

function fromApi(s: ApiSource): Source {
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    streamType: s.streamType,
    status: s.status,
    color: SOURCE_COLOR,
    liveCamera: s.liveCamera,
    latency: s.latency,
  }
}

export const useSourcesStore = create<SourcesState & SourcesActions>()(
  devtools(
    immer((set) => ({
      sources: [],
      lastFetchedAt: Date.now(),
      isLoading: false,

      fetchAll: async () => {
        set((state) => { state.isLoading = true })
        try {
          const data = await sourcesApi.list()
          set((state) => {
            state.sources = data.map(fromApi)
            state.isLoading = false
            state.lastFetchedAt = Date.now()
          })
        } catch {
          set((state) => { state.isLoading = false })
        }
      },

      refresh: async () => {
        set((state) => { state.isLoading = true })
        try {
          const data = await sourcesApi.list()
          set((state) => {
            state.sources = data.map(fromApi)
            state.isLoading = false
            state.lastFetchedAt = Date.now()
          })
        } catch {
          set((state) => { state.isLoading = false })
        }
      },

      addSource: async (source) => {
        // Strip the client-only `color` field before sending to the API.
        const { color, ...apiBody } = source
        void color
        const created = await sourcesApi.create(apiBody)
        set((state) => { state.sources.push(fromApi(created)) })
      },

      removeSource: async (id) => {
        await sourcesApi.remove(id)
        set((state) => { state.sources = state.sources.filter((s) => s.id !== id) })
      },

      updateSource: async (id, fields) => {
        const updated = await sourcesApi.update(id, fields)
        set((state) => {
          const source = state.sources.find((s) => s.id === id)
          if (source) {
            if (updated.name !== undefined) source.name = updated.name
            if (updated.address !== undefined) source.address = updated.address
            if (updated.latency !== undefined) source.latency = updated.latency
          }
        })
      },

      updateStatus: async (id, status) => {
        const updated = await sourcesApi.update(id, { status })
        set((state) => {
          const source = state.sources.find((s) => s.id === id)
          if (source) source.status = updated.status
        })
      },
    })),
    { name: 'sources', enabled: import.meta.env.DEV },
  ),
)
