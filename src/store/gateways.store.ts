import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import { gatewaysApi, type ApiGateway } from '@/lib/api'

/**
 * Read-only store for venue gateway boxes (open-live #263, OL-6 Phase 1).
 *
 * Phase 1 is strictly read-only: gateways are registered and driven by the
 * open-live backend from inbound heartbeats, so Studio only ever lists them.
 * There are no create/update/delete actions here — those are Phase 2/3.
 */
interface GatewaysState {
  gateways: ApiGateway[]
  lastFetchedAt: number
  isLoading: boolean
}

interface GatewaysActions {
  fetchAll: () => Promise<void>
}

export const useGatewaysStore = create<GatewaysState & GatewaysActions>()(
  devtools(
    immer((set) => ({
      gateways: [],
      lastFetchedAt: Date.now(),
      isLoading: false,

      fetchAll: async () => {
        set((state) => { state.isLoading = true })
        try {
          const data = await gatewaysApi.list()
          set((state) => {
            state.gateways = data
            state.isLoading = false
            state.lastFetchedAt = Date.now()
          })
        } catch {
          set((state) => { state.isLoading = false })
        }
      },
    })),
    { name: 'gateways', enabled: import.meta.env.DEV },
  ),
)
