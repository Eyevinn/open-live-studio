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

  return (
    <div className="flex items-stretch border border-zinc-800 bg-zinc-950" style={{ minHeight: 48 }}>
      {/* Section label */}
      <div className="flex items-center justify-center border-r border-zinc-800 shrink-0" style={{ width: 40 }}>
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500">DSK</span>
      </div>
      <div className="flex gap-px flex-1 p-1">
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
                'btn-hardware flex-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors flex flex-col items-center gap-0 cursor-pointer',
                active
                  ? 'bg-orange-500 text-black border-orange-400'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-white hover:border-zinc-500',
              )}
            >
              <span>{label}</span>
              {graphic && (
                <span className={cn('text-[8px] font-normal normal-case truncate max-w-full mt-0.5', active ? 'text-black/70' : 'text-zinc-600')}>
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
