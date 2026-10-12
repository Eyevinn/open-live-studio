export type TallyState = 'pgm' | 'pvw' | 'off'

/** The bus-membership inputs `resolveTallyState` reasons over. */
export interface TallyBuses {
  /** Legacy single PGM mixer-input slot (null while a PiP occupies program). */
  pgmInput: string | null
  /** Legacy single PVW mixer-input slot. */
  pvwInput: string | null
  /** Contribution-tally program pads (incl. PiP zone insets, PiP bg, DSK, graphics). */
  programInputs: string[]
  /** Contribution-tally preview pads. */
  previewInputs: string[]
}

/**
 * Pure resolver: given a source's mixer-input pads and the current bus membership,
 * returns its tally state. The contribution-tally arrays are the primary signal — they
 * include PiP zone-inset sources, PiP backgrounds, DSK and graphics, so a source shown
 * inside a PiP zone on air lights its tally even though the single `pgmInput` slot is null
 * while a PiP occupies program (open-live#492). The legacy single slots remain as a
 * fallback for older backends that do not send the contribution arrays. PGM wins over PVW.
 */
export function resolveTallyState(myInputs: readonly string[], buses: TallyBuses): TallyState {
  const { pgmInput, pvwInput, programInputs, previewInputs } = buses
  const onPgm = myInputs.some((i) => programInputs.includes(i)) || (!!pgmInput && myInputs.includes(pgmInput))
  const onPvw = myInputs.some((i) => previewInputs.includes(i)) || (!!pvwInput && myInputs.includes(pvwInput))
  if (onPgm) return 'pgm'
  if (onPvw) return 'pvw'
  return 'off'
}
