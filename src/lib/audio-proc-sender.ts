import {
  buildProcSetMessage,
  mergeStageParams,
  stageAllowedOnElement,
  stageKey,
  validateStageParams,
  type AudioProcParams,
  type AudioProcStage,
  type ProcSetMessage,
} from '@/lib/audio-processing'

/**
 * Minimum gap between two `AUDIO_PROC_SET` frames for the same element:stage.
 *
 * - Caps a dragged slider at 5 frames/s per stage — well under the issue's
 *   "about 10 per second per control" and the server's 20 msg/s per-connection
 *   rate limit that Studio's effect sliders once tripped (studio#181).
 * - Stays above the server's 150 ms per-element:stage debounce
 *   (open-live `src/ws/controller.ts`, AUDIO_PROC_SET). That debounce keeps only
 *   the newest frame's Strom write, and `params` is partial, so two frames for
 *   one stage closer than 150 ms would drop the first frame's keys from the live
 *   pipeline (e.g. moving EQ band 1 then band 2). Coalescing per stage — all
 *   keys changed since the last frame go out together — avoids that.
 */
export const PROC_SEND_INTERVAL_MS = 200

interface StageQueue {
  lastSentAt: number
  pending: AudioProcParams | null
  timer: ReturnType<typeof setTimeout> | null
}

export interface ProcSetCoalescerOptions {
  /** Puts a frame on the controller WebSocket. */
  send: (msg: ProcSetMessage) => void
  /** Called after a frame is sent, with its cmdId (to track ACK/NACK). */
  onSent?: (cmdId: string, elementId: string, stage: AudioProcStage, params: AudioProcParams) => void
  intervalMs?: number
  makeCmdId?: () => string
}

let cmdCounter = 0
function defaultCmdId(): string {
  cmdCounter += 1
  return `proc-${Date.now().toString(36)}-${cmdCounter}`
}

/**
 * Leading-and-trailing throttle for `AUDIO_PROC_SET`, keyed by element:stage
 * and merging partial params, so the final value of a drag (the release
 * position) always goes out. Same leading/trailing shape as
 * `useThrottledCallback` (studio#184), but keyed and merging, which a single
 * per-slider throttle cannot do.
 */
export class ProcSetCoalescer {
  private queues = new Map<string, StageQueue>()
  private readonly intervalMs: number
  private readonly makeCmdId: () => string

  constructor(private readonly opts: ProcSetCoalescerOptions) {
    this.intervalMs = opts.intervalMs ?? PROC_SEND_INTERVAL_MS
    this.makeCmdId = opts.makeCmdId ?? defaultCmdId
  }

  /**
   * Queue a partial change. Returns the validation error (and queues nothing)
   * when the params are out of range or the stage is not valid on the element.
   */
  queue(elementId: string, stage: AudioProcStage, params: AudioProcParams): string | null {
    if (!stageAllowedOnElement(stage, elementId)) return `stage '${stage}' is not valid on '${elementId}'`
    const error = validateStageParams(stage, params)
    if (error) return error

    const key = stageKey(elementId, stage)
    let q = this.queues.get(key)
    if (!q) {
      q = { lastSentAt: Number.NEGATIVE_INFINITY, pending: null, timer: null }
      this.queues.set(key, q)
    }
    q.pending = mergeStageParams(q.pending ?? undefined, params)

    if (q.timer !== null) return null
    const wait = q.lastSentAt + this.intervalMs - Date.now()
    if (wait <= 0) {
      this.flushKey(elementId, stage, q)
    } else {
      q.timer = setTimeout(() => {
        q.timer = null
        this.flushKey(elementId, stage, q)
      }, wait)
    }
    return null
  }

  /** True when a change for this stage is waiting for its throttle window. */
  hasQueued(elementId: string, stage: AudioProcStage): boolean {
    return this.queues.get(stageKey(elementId, stage))?.pending != null
  }

  /** Send everything still queued now and stop all timers (on unmount). */
  dispose(): void {
    for (const [key, q] of this.queues) {
      if (q.timer !== null) clearTimeout(q.timer)
      q.timer = null
      const [elementId, stage] = key.split(':') as [string, AudioProcStage]
      this.flushKey(elementId, stage, q)
    }
    this.queues.clear()
  }

  private flushKey(elementId: string, stage: AudioProcStage, q: StageQueue): void {
    const params = q.pending
    q.pending = null
    if (!params) return
    const cmdId = this.makeCmdId()
    const built = buildProcSetMessage(elementId, stage, params, cmdId)
    if (!built.ok) return // unreachable: every queued part was validated
    q.lastSentAt = Date.now()
    this.opts.send(built.msg)
    this.opts.onSent?.(cmdId, elementId, stage, params)
  }
}
