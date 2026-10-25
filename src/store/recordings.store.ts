import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import { ApiError, recordingsApi, type ApiRecording, type RecordingKind, type RecordingListFilters } from '@/lib/api'
import { recordingsErrorMessage, sortRecordings } from '@/lib/recordings'

/**
 * Recordings (open-live #42, #534, #550; studio#220, #229). Lists
 * `GET /api/v1/recordings`, or `GET /api/v1/productions/:id/recordings` when a
 * production filter is set, and keeps them newest first by `startedAt`.
 *
 * The URLs in the list expire (`RECORDING_PRESIGN_TTL_S`), so Play and Download
 * always go through `fetchFresh`, which re-reads the single recording.
 * `deleteRecording` deletes one and drops it from the list on success.
 *
 * Input recordings (OL-32, studio#233): `kindFilter` and `inputFilter` narrow
 * the list server-side with the `kind` / `mixerInput` query filters.
 */
export interface RecordingsLoadError {
  message: string
  status?: number
}

interface RecordingsState {
  recordings: ApiRecording[]
  /** Production id the list is narrowed to, or null for all recordings. */
  productionFilter: string | null
  isLoading: boolean
  /** Last failed list (e.g. backend 503), or null. Never shown together with the empty state. */
  loadError: RecordingsLoadError | null
  /** True once a list for the current filter has succeeded. */
  loaded: boolean
  /** `kind` filter (program or input recordings), or null for both. */
  kindFilter: RecordingKind | null
  /** `mixerInput` filter (one input's own recordings), or null. Cleared when the production filter changes. */
  inputFilter: string | null
}

interface RecordingsActions {
  /** Sets the production filter (null = all) and reloads the list. */
  setProductionFilter: (productionId: string | null) => Promise<void>
  /** Sets the `kind` filter (null = both) and reloads the list. */
  setKindFilter: (kind: RecordingKind | null) => Promise<void>
  /** Sets the `mixerInput` filter (null = all inputs) and reloads the list. */
  setInputFilter: (mixerInput: string | null) => Promise<void>
  fetchList: () => Promise<void>
  /** Re-reads one recording for freshly signed URLs and updates it in the list. Rethrows on failure. */
  fetchFresh: (id: string) => Promise<ApiRecording>
  /** Deletes one recording (object and entry) and removes it from the list. Rethrows on failure; the list is unchanged then. */
  deleteRecording: (id: string) => Promise<void>
}

// Monotonic request id so a slower response for a previous filter never
// overwrites the list for the current one.
let listRequestSeq = 0

export const useRecordingsStore = create<RecordingsState & RecordingsActions>()(
  devtools(
    immer((set, get) => ({
      recordings: [],
      productionFilter: null,
      isLoading: false,
      loadError: null,
      loaded: false,
      kindFilter: null,
      inputFilter: null,

      setProductionFilter: async (productionId) => {
        if (get().productionFilter !== productionId) {
          set((state) => {
            state.productionFilter = productionId
            // Pad keys are per production.
            state.inputFilter = null
            state.recordings = []
            state.loaded = false
            state.loadError = null
          })
        }
        await get().fetchList()
      },

      setKindFilter: async (kind) => {
        if (get().kindFilter !== kind) {
          set((state) => {
            state.kindFilter = kind
            // `mixerInput` implies `kind=input`.
            if (kind === 'program') state.inputFilter = null
            state.recordings = []
            state.loaded = false
            state.loadError = null
          })
        }
        await get().fetchList()
      },

      setInputFilter: async (mixerInput) => {
        if (get().inputFilter !== mixerInput) {
          set((state) => {
            state.inputFilter = mixerInput
            if (mixerInput !== null && state.kindFilter === 'program') state.kindFilter = null
            state.recordings = []
            state.loaded = false
            state.loadError = null
          })
        }
        await get().fetchList()
      },

      fetchList: async () => {
        const seq = ++listRequestSeq
        const { productionFilter: filter, kindFilter, inputFilter } = get()
        const filters: RecordingListFilters = {
          ...(kindFilter ? { kind: kindFilter } : {}),
          ...(inputFilter ? { mixerInput: inputFilter } : {}),
        }
        const query = Object.keys(filters).length > 0 ? filters : undefined
        set((state) => { state.isLoading = true })
        try {
          // Without filters, call exactly as before OL-32.
          const data = filter === null
            ? await (query ? recordingsApi.list(query) : recordingsApi.list())
            : await (query ? recordingsApi.listForProduction(filter, query) : recordingsApi.listForProduction(filter))
          if (seq !== listRequestSeq) return
          set((state) => {
            state.recordings = sortRecordings(Array.isArray(data) ? data : [])
            state.isLoading = false
            state.loadError = null
            state.loaded = true
          })
        } catch (err) {
          if (seq !== listRequestSeq) return
          set((state) => {
            state.isLoading = false
            state.loaded = false
            state.loadError = {
              message: recordingsErrorMessage(err),
              ...(err instanceof ApiError ? { status: err.status } : {}),
            }
          })
        }
      },

      fetchFresh: async (id) => {
        const fresh = await recordingsApi.get(id)
        set((state) => {
          const idx = state.recordings.findIndex((r) => r.id === id)
          if (idx >= 0) state.recordings[idx] = fresh
        })
        return fresh
      },

      deleteRecording: async (id) => {
        await recordingsApi.delete(id)
        set((state) => {
          state.recordings = state.recordings.filter((r) => r.id !== id)
        })
      },
    })),
    { name: 'recordings', enabled: import.meta.env.DEV },
  ),
)
