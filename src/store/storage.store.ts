import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import {
  storageConnectionsApi,
  type ApiStorageConnection,
  type StorageConnectionCreateInput,
  type StorageConnectionPatchInput,
} from '@/lib/api'

/**
 * Storage connections (open-live #520, OL-21; studio#217). Unlike Gateways this
 * store creates, edits and deletes. The secret key is never held here: the API
 * never returns it and the create/patch bodies are passed straight through.
 * Create/update/remove rethrow the `ApiError` so the dialog can show the backend
 * message inline (the API calls are `quiet`, so there is no toast as well).
 */
interface StorageState {
  connections: ApiStorageConnection[]
  lastFetchedAt: number
  isLoading: boolean
  /** Backend message of the last failed list, or null. */
  loadError: string | null
  /**
   * True once a list request has succeeded at least once. `lastFetchedAt` is
   * seeded with `Date.now()` at init, so it cannot tell "not loaded yet" apart.
   */
  loaded: boolean
}

interface StorageActions {
  fetchAll: () => Promise<void>
  addConnection: (body: StorageConnectionCreateInput) => Promise<ApiStorageConnection>
  updateConnection: (id: string, body: StorageConnectionPatchInput) => Promise<ApiStorageConnection>
  removeConnection: (id: string) => Promise<void>
}

export const useStorageStore = create<StorageState & StorageActions>()(
  devtools(
    immer((set) => ({
      connections: [],
      lastFetchedAt: Date.now(),
      isLoading: false,
      loadError: null,
      loaded: false,

      fetchAll: async () => {
        set((state) => { state.isLoading = true })
        try {
          const data = await storageConnectionsApi.list()
          set((state) => {
            state.connections = data
            state.isLoading = false
            state.loadError = null
            state.loaded = true
            state.lastFetchedAt = Date.now()
          })
        } catch (err) {
          set((state) => {
            state.isLoading = false
            state.loadError = err instanceof Error ? err.message : 'Failed to load storage connections'
          })
        }
      },

      addConnection: async (body) => {
        const created = await storageConnectionsApi.create(body)
        set((state) => { state.connections.push(created) })
        return created
      },

      updateConnection: async (id, body) => {
        const updated = await storageConnectionsApi.update(id, body)
        set((state) => {
          const idx = state.connections.findIndex((c) => c.id === id)
          if (idx >= 0) state.connections[idx] = updated
        })
        return updated
      },

      removeConnection: async (id) => {
        await storageConnectionsApi.remove(id)
        set((state) => { state.connections = state.connections.filter((c) => c.id !== id) })
      },
    })),
    { name: 'storage', enabled: import.meta.env.DEV },
  ),
)
