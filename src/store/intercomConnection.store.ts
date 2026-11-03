import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import {
  intercomConnectionApi,
  type ApiIntercomConnectionStatus,
  type IntercomConnectionInput,
} from '@/lib/api'
import { intercomErrorMessage } from '@/lib/intercomConnection'

/**
 * Intercom connection (open-live #617, OL-47; studio#254). A singleton: the
 * status of the connection in effect, plus save and clear. The manager API key
 * and WHIP key are never held here: the API never returns them and the `PUT`
 * body is passed straight through. Test is not in the store because it never
 * changes the stored connection. `save` / `clear` rethrow the `ApiError` so the
 * panel shows the backend message inline (the calls are `quiet`, no toast).
 */
interface IntercomConnectionState {
  status: ApiIntercomConnectionStatus | null
  isLoading: boolean
  /** Inline message of the last failed status read, or null. */
  loadError: string | null
}

interface IntercomConnectionActions {
  fetchStatus: () => Promise<void>
  save: (body: IntercomConnectionInput) => Promise<ApiIntercomConnectionStatus>
  clear: () => Promise<void>
}

export const useIntercomConnectionStore = create<IntercomConnectionState & IntercomConnectionActions>()(
  devtools(
    immer((set, get) => ({
      status: null,
      isLoading: false,
      loadError: null,

      fetchStatus: async () => {
        set((state) => { state.isLoading = true })
        try {
          const status = await intercomConnectionApi.get()
          set((state) => {
            state.status = status
            state.isLoading = false
            state.loadError = null
          })
        } catch (err) {
          set((state) => {
            state.isLoading = false
            state.loadError = intercomErrorMessage(err, 'Failed to load the intercom connection')
          })
        }
      },

      save: async (body) => {
        const status = await intercomConnectionApi.set(body)
        set((state) => {
          state.status = status
          state.loadError = null
        })
        return status
      },

      clear: async () => {
        await intercomConnectionApi.clear()
        // Env vars may apply again after a clear, so read the status back. A
        // failed read is a status-line error, not a failed clear.
        set((state) => { state.status = null })
        await get().fetchStatus()
      },
    })),
    { name: 'intercomConnection', enabled: import.meta.env.DEV },
  ),
)
