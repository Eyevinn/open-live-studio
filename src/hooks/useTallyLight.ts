import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { resolveTallyState, type TallyState } from '@/lib/tally'

export type { TallyState } from '@/lib/tally'

/**
 * Returns the tally state for a given source ID. Maps the source to all its mixer inputs,
 * then delegates to `resolveTallyState` (see `@/lib/tally`), which lights the program/preview
 * tally for PiP zone-inset sources via the contribution-tally arrays (open-live#492). Handles
 * a source assigned to multiple mixer inputs correctly.
 */
export function useTallyLight(sourceId: string): TallyState {
  const pgmInput = useProductionStore((s) => s.pgmInput)
  const pvwInput = useProductionStore((s) => s.pvwInput)
  const programInputs = useProductionStore((s) => s.programInputs)
  const previewInputs = useProductionStore((s) => s.previewInputs)
  const activeProductionId = useProductionStore((s) => s.activeProductionId)
  const production = useProductionsStore((s) => s.productions.find((p) => p.id === activeProductionId))

  const myInputs = (production?.sources ?? [])
    .filter((a) => a.sourceId === sourceId)
    .map((a) => a.mixerInput)

  return resolveTallyState(myInputs, { pgmInput, pvwInput, programInputs, previewInputs })
}
