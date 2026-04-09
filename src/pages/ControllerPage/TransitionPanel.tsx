import { useProductionStore, type TransitionType } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useTemplatesStore } from '@/store/templates.store'
import { useSourcesStore } from '@/store/sources.store'
import { cn } from '@/lib/cn'
import { useRef, useCallback } from 'react'

const DURATION_PRESETS_MS = [500, 1000, 2000]
const TRANSITION_TYPES: TransitionType[] = ['mix', 'dip', 'push']

interface TransitionPanelProps {
  onCut: () => void
  onAuto: () => void
  onFtb: () => void
  onSelectPvw: (sourceId: string) => void
  onSetOvl: (alpha: number) => void
}

export function TransitionPanel({ onCut, onAuto, onFtb, onSelectPvw, onSetOvl }: TransitionPanelProps) {
  const ovlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedSetOvl = useCallback((alpha: number) => {
    if (ovlTimerRef.current) clearTimeout(ovlTimerRef.current)
    ovlTimerRef.current = setTimeout(() => onSetOvl(alpha), 150)
  }, [onSetOvl])
  const {
    pgmSourceId, pvwSourceId, isFtb,
    transitionType, transitionDurationMs, tBarPosition,
    setPgm, setTransitionType, setTransitionDuration, setTBarPosition,
    activeProductionId,
  } = useProductionStore()

  const production = useProductionsStore((s) => s.productions.find((p) => p.id === activeProductionId))
  const template = useTemplatesStore((s) => s.templates.find((t) => t.id === production?.templateId))
  const sources = useSourcesStore((s) => s.sources)

  const slots = template?.inputs ?? []

  // Map slotId → Source object
  const slotSource = Object.fromEntries(
    (production?.sources ?? []).flatMap((a) => {
      const source = sources.find((s) => s.id === a.sourceId)
      return source ? [[a.mixerInput, source]] : []
    })
  )

  // When no template inputs are defined, fall back to all available sources
  const fallbackSources = slots.length === 0 ? sources : []

  const labelClass = 'flex items-center justify-center w-10 shrink-0 text-[10px] font-mono font-bold uppercase tracking-widest'
  const rowClass = 'flex items-center gap-1 flex-1 overflow-x-auto px-2 py-2'
  const actionGroupClass = 'flex items-center gap-1 px-2 py-2 shrink-0 border-l border-[--color-border] w-56'

  return (
    <div className="bg-[--color-surface-3] rounded-xl border border-[--color-border] overflow-hidden">

      {/* PGM row */}
      <div className="flex items-stretch border-b border-[--color-border]">
        <div className={cn(labelClass, 'text-[--color-pgm] bg-[--color-pgm]/10 border-r border-[--color-border]')}>
          PGM
        </div>
        <div className={rowClass}>
          {slots.length === 0 && fallbackSources.length === 0 && (
            <span className="text-[10px] text-[--color-text-muted] italic">
              {!production?.templateId ? 'No template assigned' : 'No sources available'}
            </span>
          )}
          {slots.map((slot) => {
            const source = slotSource[slot.id]
            const isActive = !!source && pgmSourceId === source.id
            return (
              <div
                key={slot.id}
                className={cn(
                  'flex-1 min-w-16 py-1.5 px-2 rounded text-xs font-bold truncate border cursor-default select-none flex items-center justify-center',
                  isActive
                    ? 'bg-red-600 border-white text-white'
                    : source
                      ? 'bg-[--color-surface-raised] border-[--color-border-strong] text-[--color-text-muted]'
                      : 'bg-[--color-surface] border-[--color-border] text-[--color-text-muted] opacity-40',
                )}
              >
                {source?.name ?? slot.id}
              </div>
            )
          })}
          {fallbackSources.map((source) => (
            <div
              key={source.id}
              className={cn(
                'flex-1 min-w-16 py-1.5 px-2 rounded text-xs font-bold truncate border cursor-default select-none flex items-center justify-center',
                pgmSourceId === source.id
                  ? 'bg-red-600 border-white text-white'
                  : 'bg-[--color-surface-raised] border-[--color-border-strong] text-[--color-text-muted]',
              )}
            >
              {source.name}
            </div>
          ))}
        </div>
        <div className={actionGroupClass}>
          <button
            onClick={onCut}
            className="px-4 py-1.5 rounded text-xs font-bold uppercase tracking-widest bg-red-600 border border-white text-white hover:opacity-90 transition-opacity"
          >
            CUT
          </button>
          <button
            onClick={onAuto}
            className="px-4 py-1.5 rounded text-xs font-bold uppercase tracking-widest bg-[--color-surface-raised] border border-[--color-border-strong] text-[--color-text-primary] hover:bg-[--color-surface-1] transition-colors"
          >
            AUTO
          </button>
          <button
            onClick={onFtb}
            className={cn(
              'px-4 py-1.5 rounded text-xs font-bold uppercase tracking-widest border transition-colors',
              isFtb
                ? 'bg-zinc-900 border-zinc-600 text-white'
                : 'bg-[--color-surface-raised] border-[--color-border-strong] text-[--color-text-muted] hover:text-[--color-text-primary]',
            )}
          >
            FTB
          </button>
        </div>
      </div>

      {/* PVW row */}
      <div className="flex items-stretch border-b border-[--color-border]">
        <div className={cn(labelClass, 'text-[--color-pvw] bg-[--color-pvw]/10 border-r border-[--color-border]')}>
          PVW
        </div>
        <div className={rowClass}>
          {slots.length === 0 && fallbackSources.length === 0 && (
            <span className="text-[10px] text-[--color-text-muted] italic">
              {!production?.templateId ? 'No template assigned' : 'No sources available'}
            </span>
          )}
          {slots.map((slot) => {
            const source = slotSource[slot.id]
            const isActive = !!source && pvwSourceId === source.id
            const isOnPgm = !!source && pgmSourceId === source.id
            return (
              <button
                key={slot.id}
                onClick={() => source && !isOnPgm && onSelectPvw(source.id)}
                disabled={!source || isOnPgm}
                className={cn(
                  'flex-1 min-w-16 py-1.5 px-2 rounded text-xs font-bold truncate transition-all border',
                  isActive
                    ? 'bg-green-600 border-white text-white'
                    : isOnPgm
                      ? 'bg-[--color-surface] border-[--color-border] text-[--color-text-muted] opacity-40 cursor-default'
                      : source
                        ? 'bg-[--color-surface-raised] border-[--color-border-strong] text-[--color-text-muted] hover:text-[--color-text-primary] hover:border-[--color-pvw]/50'
                        : 'bg-[--color-surface] border-[--color-border] text-[--color-text-muted] opacity-40 cursor-default',
                )}
              >
                {source?.name ?? slot.id}
              </button>
            )
          })}
          {fallbackSources.map((source) => {
            const isOnPgm = pgmSourceId === source.id
            return (
              <button
                key={source.id}
                onClick={() => !isOnPgm && onSelectPvw(source.id)}
                disabled={isOnPgm}
                className={cn(
                  'flex-1 min-w-16 py-1.5 px-2 rounded text-xs font-bold truncate transition-all border',
                  pvwSourceId === source.id
                    ? 'bg-green-600 border-white text-white'
                    : isOnPgm
                      ? 'bg-[--color-surface] border-[--color-border] text-[--color-text-muted] opacity-40 cursor-default'
                      : 'bg-[--color-surface-raised] border-[--color-border-strong] text-[--color-text-muted] hover:text-[--color-text-primary] hover:border-[--color-pvw]/50',
                )}
              >
                {source.name}
              </button>
            )
          })}
        </div>
        <div className={actionGroupClass}>
          {TRANSITION_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setTransitionType(type)}
              className={cn(
                'px-4 py-1.5 rounded text-xs font-bold uppercase tracking-widest border transition-colors',
                transitionType === type
                  ? 'bg-sky-400 border-sky-400 text-zinc-900'
                  : 'bg-[--color-surface-raised] border-[--color-border-strong] text-[--color-text-muted] hover:text-[--color-text-primary]',
              )}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* OVL / T-bar row */}
      <div className="flex items-stretch">
        <div className={cn(labelClass, 'text-[--color-text-muted] border-r border-[--color-border]')}>
          OVL
        </div>
        <div className="flex items-center gap-3 flex-1 px-3 py-2">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(tBarPosition * 100)}
            onChange={(e) => { const v = Number(e.target.value) / 100; setTBarPosition(v); debouncedSetOvl(v) }}
            className="flex-1 h-1.5"
          />
          <span className="text-xs font-mono text-[--color-text-muted] w-8 text-right tabular-nums">
            {tBarPosition.toFixed(2)}
          </span>
        </div>
        <div className={cn(actionGroupClass, 'gap-1.5')}>
          {DURATION_PRESETS_MS.map((ms) => (
            <button
              key={ms}
              onClick={() => setTransitionDuration(ms)}
              className={cn(
                'px-2.5 py-1 rounded text-[10px] font-mono border transition-colors',
                transitionDurationMs === ms
                  ? 'bg-sky-400 border-sky-400 text-zinc-900'
                  : 'bg-[--color-surface-raised] border-[--color-border-strong] text-[--color-text-muted] hover:text-[--color-text-primary]',
              )}
            >
              {ms / 1000}s
            </button>
          ))}
          <input
            type="number"
            min={100}
            max={10000}
            step={100}
            value={transitionDurationMs}
            onChange={(e) => setTransitionDuration(Number(e.target.value))}
            className="w-14 px-2 py-1 rounded border border-[--color-border-strong] bg-[--color-surface-raised] text-[10px] font-mono text-[--color-text-primary] text-right focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
          />
        </div>
      </div>

    </div>
  )
}
