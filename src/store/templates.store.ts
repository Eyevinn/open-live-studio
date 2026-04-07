import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import { templatesApi, type ApiTemplate } from '@/lib/api'

interface TemplatesState {
  templates: ApiTemplate[]
  isLoading: boolean
}

interface TemplatesActions {
  fetchAll: () => Promise<void>
}

export const useTemplatesStore = create<TemplatesState & TemplatesActions>()(
  devtools(
    immer((set) => ({
      templates: [],
      isLoading: false,

      fetchAll: async () => {
        set((state) => { state.isLoading = true })
        try {
          const data = await templatesApi.list()
          set((state) => {
            state.templates = data
            state.isLoading = false
          })
        } catch {
          set((state) => { state.isLoading = false })
        }
      },
    })),
    { name: 'templates' },
  ),
)
