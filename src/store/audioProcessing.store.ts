import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import {
  AUDIO_PROC_STAGES,
  defaultStageParams,
  mergeStageParams,
  parseParams,
  stageAllowedOnElement,
  stageKey,
  type AudioProcParams,
  type AudioProcStage,
  type ProcStateFrame,
} from '@/lib/audio-processing'

/**
 * Audio processing state (OL-25b, studio#231).
 *
 * `known` is what the UI renders: the latest server broadcast plus this
 * operator's optimistic edits. `confirmed` is the last value the server has
 * vouched for — connect replay, a REST hydrate, an `applied: true` broadcast,
 * an `ACK executed` for our own command, or another operator's broadcast while
 * we have nothing in flight on that stage. A `NACK` reverts the rejected keys
 * from `known` back to `confirmed` and records an error for that stage. A
 * command that leaves without its own ACK/NACK (TTL expiry, reconnect) also
 * reconciles its keys in `known` back to `confirmed`.
 *
 * Both maps hold PARTIAL params per stage; a missing key means the Strom default
 * (`defaultStageParams`), exactly like the server's persisted store.
 */

type ElementStages = Partial<Record<AudioProcStage, AudioProcParams>>

interface PendingCmd {
  elementId: string
  stage: AudioProcStage
  params: AudioProcParams
  seq: number
  sentAt: number
}

export interface StageError {
  message: string
  /** Control ids that were rejected: a scalar key (`threshold`), `enabled`, or `bands.<n>.<field>`. */
  fields: string[]
}

interface AudioProcessingState {
  productionId: string | null
  known: Record<string, ElementStages>
  confirmed: Record<string, ElementStages>
  pending: Record<string, PendingCmd>
  errors: Record<string, StageError>
}

interface AudioProcessingActions {
  /** Clear everything; called when the controller connects to a production. */
  reset: (productionId: string | null) => void
  /** Apply an inbound `AUDIO_PROC_STATE` frame (optimistic or `applied`). */
  applyState: (frame: ProcStateFrame) => void
  /** Seed from `GET .../audio/{elementId}/processing`. Skips stages with a command in flight. */
  hydrate: (productionId: string, elementId: string, processing: Record<string, unknown>) => void
  /** Optimistic local edit, before the coalesced send goes out. Clears the stage's error. */
  localEdit: (elementId: string, stage: AudioProcStage, params: AudioProcParams) => void
  /** Record an `AUDIO_PROC_SET` we sent with `cmdId`. */
  registerPending: (cmdId: string, elementId: string, stage: AudioProcStage, params: AudioProcParams) => void
  /** `ACK executed` for our command. Returns false when the cmdId is not ours. */
  ack: (cmdId: string) => boolean
  /** `NACK` for our command: revert and record the error. Returns false when the cmdId is not ours. */
  nack: (cmdId: string, error: string) => boolean
  /** Forget in-flight commands (their ACK/NACK cannot arrive on a new socket) and reconcile `known` to `confirmed`. */
  clearPending: () => void
  /** Record a client-side error (e.g. a value that failed validation and was not sent). */
  setError: (elementId: string, stage: AudioProcStage, error: StageError | null) => void
}

/** In-flight commands older than this are forgotten (the server's debounce can supersede them silently). */
export const PENDING_TTL_MS = 10_000

let seqCounter = 0

/** Control ids touched by a params object (see `StageError.fields`). */
export function paramFieldIds(params: AudioProcParams): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    if (k === 'bands') {
      for (const b of params.bands ?? []) {
        for (const f of ['freq', 'gain', 'q'] as const) if (b[f] !== undefined) out.push(`bands.${b.band}.${f}`)
      }
    } else {
      out.push(k)
    }
  }
  return out
}

/**
 * The value of each key in `sent`, taken from `confirmed` (or the stage default
 * when never confirmed). Used to roll back a rejected command.
 */
export function revertParams(stage: AudioProcStage, sent: AudioProcParams, confirmed: AudioProcParams | undefined): AudioProcParams {
  const base = mergeStageParams(defaultStageParams(stage), confirmed ?? {})
  const out: AudioProcParams = {}
  for (const key of Object.keys(sent) as Array<keyof AudioProcParams>) {
    if (key === 'bands') {
      out.bands = (sent.bands ?? []).map((b) => {
        const cb = base.bands?.find((x) => x.band === b.band)
        const rb: { band: number; freq?: number; gain?: number; q?: number } = { band: b.band }
        for (const f of ['freq', 'gain', 'q'] as const) if (b[f] !== undefined) rb[f] = cb?.[f]
        return rb
      })
    } else if (sent[key] !== undefined) {
      ;(out as Record<string, unknown>)[key] = base[key]
    }
  }
  return out
}

/** `params` without the control ids in `drop` (see `paramFieldIds`). */
export function omitFields(params: AudioProcParams, drop: Set<string>): AudioProcParams {
  if (drop.size === 0) return params
  const out: AudioProcParams = {}
  for (const key of Object.keys(params) as Array<keyof AudioProcParams>) {
    if (key === 'bands') {
      const bands = (params.bands ?? [])
        .map((b) => {
          const kept: { band: number; freq?: number; gain?: number; q?: number } = { band: b.band }
          for (const f of ['freq', 'gain', 'q'] as const) {
            if (b[f] !== undefined && !drop.has(`bands.${b.band}.${f}`)) kept[f] = b[f]
          }
          return kept
        })
        .filter((b) => Object.keys(b).length > 1)
      if (bands.length > 0) out.bands = bands
    } else if (!drop.has(key) && params[key] !== undefined) {
      ;(out as Record<string, unknown>)[key] = params[key]
    }
  }
  return out
}

/**
 * Forget the in-flight commands in `ids` without an ACK/NACK of their own (TTL
 * expiry, or a reconnect), and reconcile `known` back to `confirmed` for their
 * keys that no remaining command on the same element:stage still covers.
 *
 * While a key is in flight `applyState` keeps the local value in `known` and
 * only `confirmed` follows other operators' `applied` broadcasts. If the
 * command's own ACK never arrives (the server's shared per-element:stage
 * debounce superseded it, or the socket dropped), nothing else would ever pull
 * `known` back to what the server holds.
 */
function dropPending(s: AudioProcessingState, ids: string[]): void {
  const dropped: PendingCmd[] = []
  for (const id of ids) {
    const p = s.pending[id]
    if (!p) continue
    dropped.push(p)
    delete s.pending[id]
  }
  for (const p of dropped) {
    const stillInFlight = new Set(
      Object.values(s.pending)
        .filter((q) => q.elementId === p.elementId && q.stage === p.stage)
        .flatMap((q) => paramFieldIds(q.params)),
    )
    const keys = omitFields(p.params, stillInFlight)
    if (Object.keys(keys).length === 0) continue
    const rollback = revertParams(p.stage, keys, s.confirmed[p.elementId]?.[p.stage])
    const known = (s.known[p.elementId] ??= {})
    known[p.stage] = mergeStageParams(known[p.stage], rollback)
  }
}

function prunePending(s: AudioProcessingState, now: number): void {
  dropPending(
    s,
    Object.entries(s.pending)
      .filter(([, p]) => now - p.sentAt > PENDING_TTL_MS)
      .map(([id]) => id),
  )
}

function hasPendingFor(pending: Record<string, PendingCmd>, elementId: string, stage: AudioProcStage): boolean {
  return Object.values(pending).some((p) => p.elementId === elementId && p.stage === stage)
}

export const useAudioProcessingStore = create<AudioProcessingState & AudioProcessingActions>()(
  devtools(
    immer((set, get) => ({
      productionId: null,
      known: {},
      confirmed: {},
      pending: {},
      errors: {},

      reset: (productionId) =>
        set((s) => {
          s.productionId = productionId
          s.known = {}
          s.confirmed = {}
          s.pending = {}
          s.errors = {}
        }),

      applyState: ({ elementId, stage, params, applied }) =>
        set((s) => {
          prunePending(s, Date.now())
          // Keys this client still has in flight keep the local (newer) value: an
          // echo of an older frame from the same drag must not pull the control
          // back. The key's own ACK/NACK settles it.
          const inFlight = new Set(
            Object.values(s.pending)
              .filter((p) => p.elementId === elementId && p.stage === stage)
              .flatMap((p) => paramFieldIds(p.params)),
          )
          const known = (s.known[elementId] ??= {})
          known[stage] = mergeStageParams(known[stage], omitFields(params, inFlight))
          if (applied || inFlight.size === 0) {
            const conf = (s.confirmed[elementId] ??= {})
            conf[stage] = mergeStageParams(conf[stage], params)
          }
        }),

      hydrate: (productionId, elementId, processing) =>
        set((s) => {
          if (s.productionId !== productionId) return
          // Expire stale commands first: there is no timer, and a lingering
          // expired command would make the loop below skip its stage forever.
          prunePending(s, Date.now())
          for (const stage of AUDIO_PROC_STAGES) {
            if (!stageAllowedOnElement(stage, elementId) || !(stage in processing)) continue
            if (hasPendingFor(s.pending, elementId, stage)) continue
            const params = parseParams(processing[stage])
            ;(s.known[elementId] ??= {})[stage] = params
            ;(s.confirmed[elementId] ??= {})[stage] = params
          }
        }),

      localEdit: (elementId, stage, params) =>
        set((s) => {
          const known = (s.known[elementId] ??= {})
          known[stage] = mergeStageParams(known[stage], params)
          delete s.errors[stageKey(elementId, stage)]
        }),

      registerPending: (cmdId, elementId, stage, params) =>
        set((s) => {
          const now = Date.now()
          // Register first, so pruning an expired command on the same keys does
          // not reconcile away the value this command is sending.
          s.pending[cmdId] = { elementId, stage, params, seq: ++seqCounter, sentAt: now }
          prunePending(s, now)
        }),

      ack: (cmdId) => {
        const cmd = get().pending[cmdId]
        if (!cmd) return false
        set((s) => {
          // The server debounces per element:stage, so an older in-flight command
          // on the same stage may never get its own ACK. Its value was persisted
          // either way; fold it (and this one) into `confirmed`, oldest first.
          const resolved = Object.entries(s.pending)
            .filter(([, p]) => p.elementId === cmd.elementId && p.stage === cmd.stage && p.seq <= cmd.seq)
            .sort(([, a], [, b]) => a.seq - b.seq)
          const conf = (s.confirmed[cmd.elementId] ??= {})
          for (const [id, p] of resolved) {
            conf[cmd.stage] = mergeStageParams(conf[cmd.stage], p.params)
            delete s.pending[id]
          }
        })
        return true
      },

      nack: (cmdId, error) => {
        const cmd = get().pending[cmdId]
        if (!cmd) return false
        set((s) => {
          delete s.pending[cmdId]
          const confirmed = s.confirmed[cmd.elementId]?.[cmd.stage]
          const rollback = revertParams(cmd.stage, cmd.params, confirmed)
          const known = (s.known[cmd.elementId] ??= {})
          known[cmd.stage] = mergeStageParams(known[cmd.stage], rollback)
          s.errors[stageKey(cmd.elementId, cmd.stage)] = { message: error, fields: paramFieldIds(cmd.params) }
        })
        return true
      },

      clearPending: () =>
        set((s) => { dropPending(s, Object.keys(s.pending)) }),

      setError: (elementId, stage, error) =>
        set((s) => {
          const key = stageKey(elementId, stage)
          if (error) s.errors[key] = error
          else delete s.errors[key]
        }),
    })),
    { name: 'audio-processing', enabled: import.meta.env.DEV },
  ),
)
