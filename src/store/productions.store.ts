import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import { productionsApi, type ApiProduction, type ProductionSourceAssignment, type ProductionGraphicAssignment, type ProductionOutputAssignment } from '@/lib/api'

export type ProductionStatus = 'active' | 'inactive' | 'activating'

const ACTIVATION_POLL_INTERVAL_MS = 1000
const ACTIVATION_POLL_TIMEOUT_MS = 35000
// Minimum delay before retrying after a network error — prevents burst-recursion
// when errors resolve instantly (e.g. DNS NXDOMAIN returning immediately)
const ACTIVATION_POLL_ERROR_DELAY_MS = 2000

export interface Production {
  id: string
  name: string
  status: ProductionStatus
  sources: ProductionSourceAssignment[]
  graphicAssignments: ProductionGraphicAssignment[]
  outputAssignments: ProductionOutputAssignment[]
  whepOutputUrls?: Array<{ outputId: string; url: string }>
  stromFlowId?: string
  whepEndpoint?: string
  pgmWhepEndpoint?: string
  whipEndpoints?: Array<{ mixerInput: string; url: string }>
  srtOutputUri?: string
  values?: Record<string, string | number | boolean>
  airTime?: string
  deletionWarnings?: Array<{ type: 'source' | 'graphic' | 'output'; name: string }>
  subscriberCount?: number
  autoDeactivated?: boolean
  idleExpiresAt?: number
  inputResolutions?: Array<{ width: number; height: number } | null>
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
  markInactive: (id: string) => void
  updateName: (id: string, name: string) => Promise<void>
  updateValues: (id: string, values: Record<string, string | number | boolean>) => Promise<void>
  updateAirTime: (id: string, airTime: string | null) => Promise<void>
  assignSource: (id: string, assignment: ProductionSourceAssignment) => Promise<void>
  unassignSource: (id: string, mixerInput: string) => Promise<void>
  assignGraphic: (id: string, assignment: ProductionGraphicAssignment) => Promise<void>
  unassignGraphic: (id: string, dskInput: string) => Promise<void>
  assignOutput: (id: string, outputId: string) => Promise<void>
  unassignOutput: (id: string, outputId: string) => Promise<void>
  refreshOne: (id: string) => Promise<void>
}

function fromApi(p: ApiProduction): Production {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    sources: p.sources ?? [],
    graphicAssignments: p.graphicAssignments ?? [],
    outputAssignments: p.outputAssignments ?? [],
    whepOutputUrls: p.whepOutputUrls,
    stromFlowId: p.stromFlowId,
    whepEndpoint: p.whepEndpoint,
    pgmWhepEndpoint: p.pgmWhepEndpoint,
    whipEndpoints: p.whipEndpoints,
    srtOutputUri: p.srtOutputUri,
    values: p.values,
    airTime: p.airTime,
    deletionWarnings: p.deletionWarnings,
    subscriberCount: p.subscriberCount,
    autoDeactivated: p.autoDeactivated,
    idleExpiresAt: p.idleExpiresAt,
    inputResolutions: p.inputResolutions,
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
            prod.whepEndpoint = updated.whepEndpoint
            prod.pgmWhepEndpoint = updated.pgmWhepEndpoint
            if (updated.status === 'inactive') {
              prod.whipEndpoints = undefined
              prod.srtOutputUri = undefined
              prod.whepOutputUrls = undefined
            }
          }
        })

        if (updated.status === 'activating') {
          // Poll until status is no longer 'activating' or timeout is reached
          const deadline = Date.now() + ACTIVATION_POLL_TIMEOUT_MS
          const poll = async (): Promise<void> => {
            if (Date.now() >= deadline) {
              // eslint-disable-next-line no-console -- surfaces activation polling timeout for diagnostics
              console.warn(`[productions] Activation polling timed out for production ${id}`)
              return
            }
            await new Promise<void>((resolve) => setTimeout(resolve, ACTIVATION_POLL_INTERVAL_MS))
            try {
              const polled = await productionsApi.get(id)
              set((state) => {
                const prod = state.productions.find((p) => p.id === id)
                if (prod) {
                  prod.status = polled.status
                  prod.stromFlowId = polled.stromFlowId
                  prod.whepEndpoint = polled.whepEndpoint
                  prod.pgmWhepEndpoint = polled.pgmWhepEndpoint
                  prod.whipEndpoints = polled.whipEndpoints
                  prod.whepOutputUrls = polled.whepOutputUrls
                  prod.srtOutputUri = polled.srtOutputUri
                }
              })
              if (polled.status === 'activating') {
                await poll()
              }
            } catch (err) {
              // eslint-disable-next-line no-console -- surfaces activation poll errors for diagnostics
              console.error(`[productions] Activation poll error for ${id}:`, err)
              // Wait before retrying to prevent burst-recursion on instant-failing errors
              await new Promise<void>((resolve) => setTimeout(resolve, ACTIVATION_POLL_ERROR_DELAY_MS))
              await poll()
            }
          }
          await poll()
        }
      },

      markInactive: (id) => {
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (prod) {
            prod.status = 'inactive'
            prod.stromFlowId = undefined
            prod.whepEndpoint = undefined
            prod.pgmWhepEndpoint = undefined
            prod.whipEndpoints = undefined
            prod.srtOutputUri = undefined
            prod.whepOutputUrls = undefined
          }
        })
      },

      updateName: async (id, name) => {
        await productionsApi.update(id, { name })
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (prod) prod.name = name
        })
      },

      updateValues: async (id, values) => {
        const updated = await productionsApi.update(id, { values })
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (prod) prod.values = updated.values
        })
      },

      updateAirTime: async (id, airTime) => {
        await productionsApi.update(id, { airTime })
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (prod) prod.airTime = airTime ?? undefined
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

      assignGraphic: async (id, assignment) => {
        await productionsApi.assignGraphic(id, assignment)
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (!prod) return
          const existing = prod.graphicAssignments.findIndex((g) => g.dskInput === assignment.dskInput)
          if (existing !== -1) {
            prod.graphicAssignments[existing] = assignment
          } else {
            prod.graphicAssignments.push(assignment)
          }
        })
      },

      unassignGraphic: async (id, dskInput) => {
        await productionsApi.unassignGraphic(id, dskInput)
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (prod) prod.graphicAssignments = prod.graphicAssignments.filter((g) => g.dskInput !== dskInput)
        })
      },

      assignOutput: async (id, outputId) => {
        await productionsApi.assignOutput(id, outputId)
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (!prod) return
          if (!prod.outputAssignments.some((o) => o.outputId === outputId)) {
            prod.outputAssignments.push({ outputId })
          }
        })
      },

      unassignOutput: async (id, outputId) => {
        await productionsApi.unassignOutput(id, outputId)
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (prod) prod.outputAssignments = prod.outputAssignments.filter((o) => o.outputId !== outputId)
        })
      },

      refreshOne: async (id) => {
        const updated = await productionsApi.get(id)
        set((state) => {
          const prod = state.productions.find((p) => p.id === id)
          if (prod) prod.inputResolutions = updated.inputResolutions
        })
      },
    })),
    { name: 'productions', enabled: import.meta.env.DEV },
  ),
)
