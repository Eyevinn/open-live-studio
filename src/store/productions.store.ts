import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import { productionsApi, type ApiProduction, type ProductionSourceAssignment } from '@/lib/api'

export type ProductionStatus = 'active' | 'inactive'

export interface Production {
  id: string
  name: string
  status: ProductionStatus
  sources: ProductionSourceAssignment[]
  templateId?: string
  stromFlowId?: string
  whepEndpoint?: string
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
  updateTemplateId: (id: string, templateId: string | null) => Promise<void>
  assignSource: (id: string, assignment: ProductionSourceAssignment) => Promise<void>
  unassignSource: (id: string, mixerInput: string) => Promise<void>
}

function fromApi(p: ApiProduction): Production {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    sources: p.sources ?? [],
    templateId: p.templateId,
    stromFlowId: p.stromFlowId,
    whepEndpoint: p.whepEndpoint,
  }
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
          if (prod) {
            prod.status = updated.status
            prod.stromFlowId = updated.stromFlowId
          }
        })
      },

      updateTemplateId: async (id, templateId) => {
        const updated = await productionsApi.update(id, { templateId })
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (prod) prod.templateId = updated.templateId
        })
      },

      assignSource: async (id, assignment) => {
        await productionsApi.assignSource(id, assignment)
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (!prod) return
          const existing = prod.sources.findIndex((s) => s.mixerInput === assignment.mixerInput)
          if (existing !== -1) {
            prod.sources[existing] = assignment
          } else {
            prod.sources.push(assignment)
          }
        })
      },

      unassignSource: async (id, mixerInput) => {
        await productionsApi.unassignSource(id, mixerInput)
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (prod) prod.sources = prod.sources.filter((s) => s.mixerInput !== mixerInput)
        })
      },
    })),
    { name: 'productions' },
  ),
)
