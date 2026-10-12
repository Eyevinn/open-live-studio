import type { PipConfig } from '@/store/production.store'
import type { DroppedGuest } from '@/store/guests.store'

/**
 * Parse the trailing index of a `video_in_N` mixer-input name — the integer id
 * a PiP zone stores in `sources`. Returns null for names without that suffix.
 * (PiP zone sources are pad indices, so this is the bridge from a guest's
 * `mixerInput` string to the numeric ids a PiP composition references.)
 */
function padToIndex(mixerInput: string): number | null {
  const m = /video_in_(\d+)$/.exec(mixerInput ?? '')
  return m?.[1] !== undefined ? parseInt(m[1], 10) : null
}

/** Current program state needed to decide whether a dropped input is live. */
export interface LiveDropContext {
  /** Mixer input currently on program, or null. */
  pgmInput: string | null
  /** Index into `pips` of the PiP currently on program, or null. */
  pgmPip: number | null
  /** All configured PiP compositions. */
  pips: PipConfig[]
}

/** Collect the pad indices referenced by a PiP's zones. */
function pipSourceIndices(pip: PipConfig | undefined): Set<number> {
  return new Set((pip?.zones ?? []).flatMap((z) => z.sources))
}

/**
 * The subset of dropped inputs that are *currently live on program* — either
 * taken directly to program or a source inside the PiP that is on program.
 * Only these warrant the on-air "guest dropped" warning on the vision-mixer
 * source tile; a drop on an input that is not live stays silent. The warning is
 * informational only and never triggers a cut (studio#193).
 */
export function liveDroppedMixerInputs(
  droppedInputs: Record<string, DroppedGuest>,
  ctx: LiveDropContext,
): Set<string> {
  const live = new Set<string>()
  const pgmPipSources =
    ctx.pgmPip !== null ? pipSourceIndices(ctx.pips[ctx.pgmPip]) : null
  for (const mixerInput of Object.keys(droppedInputs)) {
    if (mixerInput === ctx.pgmInput) {
      live.add(mixerInput)
      continue
    }
    const idx = padToIndex(mixerInput)
    if (idx !== null && pgmPipSources?.has(idx)) live.add(mixerInput)
  }
  return live
}

/**
 * Indices of PiP compositions that contain at least one dropped guest's input.
 * Drives the "guest dropped" warning on the PiP button so the operator sees the
 * drop whether the PiP is live or still queued on preview (studio#193).
 */
export function droppedPipIndices(
  pips: PipConfig[],
  droppedInputs: Record<string, DroppedGuest>,
): Set<number> {
  const droppedIdx = new Set(
    Object.keys(droppedInputs)
      .map(padToIndex)
      .filter((n): n is number => n !== null),
  )
  const result = new Set<number>()
  if (droppedIdx.size === 0) return result
  pips.forEach((pip, pipIdx) => {
    for (const src of pipSourceIndices(pip)) {
      if (droppedIdx.has(src)) {
        result.add(pipIdx)
        break
      }
    }
  })
  return result
}
