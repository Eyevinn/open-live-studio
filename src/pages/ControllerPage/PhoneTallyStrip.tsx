/**
 * PhoneTallyStrip — read-only tally/status strip for the phone tier (<768px) (#155)
 *
 * Below 768px the mixer is replaced by the operator-lite notice
 * (docs/decisions/ADR-001-phone-tier-responsive-mode.md). ADR-001 says the
 * essential phone-tier surfaces are Tally and production/source status,
 * read-only. This strip renders exactly that under the notice: the active
 * production name, on-air state, and the current PGM / PVW source names with a
 * TallyLight each. It renders no controls and mutates no state.
 *
 * The standalone Tally page this status was originally expected to live on was
 * removed as dead code (#133 / #137), so the status is surfaced here directly.
 */
import { TallyLight } from '@/components/ui/TallyLight'
import { useTallyLight, type TallyState } from '@/hooks/useTallyLight'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { useIsOnAir } from '@/store/programClock.store'
import { cn } from '@/lib/cn'

// Same virtual-source labels the desktop controller uses for built-in inputs that
// have no entry in the saved sources store (TransitionPanel, PipPanel,
// SetupPage/ProductionsPanel's SourceAssignmentBadge all keep their own copy of
// this map).
const VIRTUAL_SOURCE_NAMES: Record<string, string> = {
  'Whip': 'WHIP',
  '__test1__': 'Pinwheel',
  '__test2__': 'Colors',
}

function TallyRow({ label, state, name }: { label: string; state: TallyState; name: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-8 shrink-0 text-[9px] font-bold uppercase tracking-widest text-[--color-text-muted]">
        {label}
      </span>
      <TallyLight state={state} size="sm" />
      <span className="min-w-0 truncate text-xs font-semibold text-[--color-text-primary]">
        {name}
      </span>
    </div>
  )
}

export function PhoneTallyStrip() {
  const activeProductionId = useProductionStore((s) => s.activeProductionId)
  const pgmInput = useProductionStore((s) => s.pgmInput)
  const pvwInput = useProductionStore((s) => s.pvwInput)
  const pgmPip = useProductionStore((s) => s.pgmPip)
  const pvwPip = useProductionStore((s) => s.pvwPip)
  const production = useProductionsStore((s) => s.productions.find((p) => p.id === activeProductionId))
  const sources = useSourcesStore((s) => s.sources)
  const isOnAir = useIsOnAir()

  const sourceIdForInput = (input: string | null): string => {
    if (!input) return ''
    return production?.sources?.find((a) => a.mixerInput === input)?.sourceId ?? ''
  }
  // Same fallback order the desktop controller uses: saved source name, then the
  // built-in virtual-source label, then '—' for a genuinely unresolved input.
  const nameForSourceId = (sourceId: string): string =>
    (sourceId ? sources.find((s) => s.id === sourceId)?.name : undefined) ?? VIRTUAL_SOURCE_NAMES[sourceId] ?? '—'

  const pgmSourceId = sourceIdForInput(pgmInput)
  const pvwSourceId = sourceIdForInput(pvwInput)

  // useTallyLight resolves 'pgm' | 'pvw' | 'off' from the live mixer state; an
  // empty sourceId (nothing on that bus) resolves to 'off'.
  const pgmSourceTally = useTallyLight(pgmSourceId)
  const pvwSourceTally = useTallyLight(pvwSourceId)

  // A PiP slot is a composite, not a mixer input — it never has a production.sources
  // entry, so the desktop controller (TransitionPanel, PipPanel) labels and tallies
  // it directly from pgmPip/pvwPip instead of resolving it via sourceId.
  const pgmName = pgmPip !== null ? `PiP ${pgmPip + 1}` : nameForSourceId(pgmSourceId)
  const pvwName = pvwPip !== null ? `PiP ${pvwPip + 1}` : nameForSourceId(pvwSourceId)
  const pgmState: TallyState = pgmPip !== null ? 'pgm' : pgmSourceTally
  const pvwState: TallyState = pvwPip !== null ? 'pvw' : pvwSourceTally

  return (
    <div
      className="flex-none border-t border-zinc-800 px-4 py-3"
      style={{ background: '#0a0a0a' }}
      role="status"
      aria-label="Tally and production status"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-widest text-[--color-text-muted]">
          {production?.name ?? 'No production'}
        </span>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest',
            isOnAir ? 'text-[#ff2222]' : 'text-zinc-500',
          )}
        >
          <span aria-hidden="true">●</span>
          {isOnAir ? 'On air' : 'Off air'}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <TallyRow label="PGM" state={pgmState} name={pgmName} />
        <TallyRow label="PVW" state={pvwState} name={pvwName} />
      </div>
    </div>
  )
}
