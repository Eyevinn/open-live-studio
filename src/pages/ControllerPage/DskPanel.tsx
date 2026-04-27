import { cn } from '@/lib/cn'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useGraphicsStore } from '@/store/graphics.store'

const DSK_LABELS: Record<string, string> = {
  dsk_in_0: 'DSK 1',
  dsk_in_1: 'DSK 2',
}

interface DskPanelProps {
  onToggle: (layer: number, visible: boolean) => void
}

export function DskPanel({ onToggle }: DskPanelProps) {
  const dskState = useProductionStore((s) => s.dskState)
  const activeProductionId = useProductionStore((s) => s.activeProductionId)
  const production = useProductionsStore((s) => s.productions.find((p) => p.id === activeProductionId))
  const graphics = useGraphicsStore((s) => s.graphics)

  const assignments = production?.graphicAssignments ?? []
  if (assignments.length === 0) return null

  return (
    <div className="flex flex-col gap-2 p-3 bg-[--color-surface-3] rounded-xl border border-[--color-border]">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[--color-text-muted]">DSK</span>
      <div className="flex gap-2">
        {assignments.map((a) => {
          const dskMatch = /dsk_in_(\d+)$/.exec(a.dskInput)
          if (!dskMatch) return null
          const layer = parseInt(dskMatch[1] ?? '0', 10)
          const active = dskState[layer] ?? false
          const graphic = graphics.find((g) => g.id === a.graphicId)
          const label = DSK_LABELS[a.dskInput] ?? a.dskInput

          return (
            <button
              key={a.dskInput}
              onClick={() => onToggle(layer, !active)}
              className={cn(
                'flex-1 py-2 px-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border flex flex-col items-center gap-0.5',
                active
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-[--color-surface-raised] text-[--color-text-muted] border-[--color-border] hover:border-[--color-border-strong]',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span>{label}</span>
              </div>
              {graphic && (
                <span className={cn('text-[9px] font-normal normal-case truncate max-w-full', active ? 'text-white/70' : 'text-[--color-text-muted]')}>
                  {graphic.name}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
