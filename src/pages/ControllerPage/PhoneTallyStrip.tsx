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
import { useTallyLight } from '@/hooks/useTallyLight'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { useIsOnAir } from '@/store/programClock.store'
import { cn } from '@/lib/cn'

function TallyRow({ label, sourceId, name }: { label: string; sourceId: string; name: string }) {
  // useTallyLight resolves 'pgm' | 'pvw' | 'off' from the live mixer state; an
  // empty sourceId (nothing on that bus) resolves to 'off'.
  const state = useTallyLight(sourceId)
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
  const production = useProductionsStore((s) => s.productions.find((p) => p.id === activeProductionId))
  const sources = useSourcesStore((s) => s.sources)
  const isOnAir = useIsOnAir()

  const sourceIdForInput = (input: string | null): string => {
    if (!input) return ''
    return production?.sources?.find((a) => a.mixerInput === input)?.sourceId ?? ''
  }
  const nameForSourceId = (sourceId: string): string =>
    (sourceId ? sources.find((s) => s.id === sourceId)?.name : undefined) ?? '—'

  const pgmSourceId = sourceIdForInput(pgmInput)
  const pvwSourceId = sourceIdForInput(pvwInput)

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
        <TallyRow label="PGM" sourceId={pgmSourceId} name={nameForSourceId(pgmSourceId)} />
        <TallyRow label="PVW" sourceId={pvwSourceId} name={nameForSourceId(pvwSourceId)} />
      </div>
    </div>
  )
}
