import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import { productionsApi, type ApiProduction } from '@/lib/api'

export type ProductionStatus = 'active' | 'inactive'

export interface Production {
  id: string
  name: string
  status: ProductionStatus
}

interface ProductionsState {
  productions: Production[]
  isLoading: boolean
  lastFetchedAt: number
}

interface ProductionsActions {
  fetchAll: () => Promise<void>
  addProduction: (name: string) => Promise<void>
  removeProduction: (id: string) => Promise<void>
  updateStatus: (id: string, status: ProductionStatus) => Promise<void>
}

function fromApi(p: ApiProduction): Production {
  return { id: p.id, name: p.name, status: p.status }
}

export const useProductionsStore = create<ProductionsState & ProductionsActions>()(
  devtools(
    immer((set) => ({
      productions: [],
      isLoading: false,
      lastFetchedAt: Date.now(),

      fetchAll: async () => {
        set((state) => { state.isLoading = true })
        try {
          const data = await productionsApi.list()
          set((state) => {
            state.productions = data.map(fromApi)
            state.isLoading = false
            state.lastFetchedAt = Date.now()
          })
        } catch {
          set((state) => { state.isLoading = false })
        }
      },

      addProduction: async (name) => {
        const created = await productionsApi.create({ name })
        set((state) => { state.productions.push(fromApi(created)) })
      },

      removeProduction: async (id) => {
        await productionsApi.remove(id)
        set((state) => {
          state.productions = state.productions.filter((p) => p.id !== id)
        })
      },

      updateStatus: async (id, status) => {
        const updated = await (status === 'active'
          ? productionsApi.activate(id)
          : productionsApi.deactivate(id))
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (prod) prod.status = updated.status
        })
      },
    })),
    { name: 'productions' },
  ),
)
