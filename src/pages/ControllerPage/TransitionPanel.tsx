import { useProductionStore, type TransitionType } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { cn } from '@/lib/cn'
import { useRef, useCallback, useState, useEffect } from 'react'

const DURATION_PRESETS_MS = [500, 1000, 2000]
const TRANSITION_TYPES: TransitionType[] = ['fade', 'slide_left', 'slide_right', 'slide_up', 'slide_down']

const TRANSITION_LABELS: Record<TransitionType, string> = {
  fade:        'FADE',
  slide_left:  '← PUSH',
  slide_right: 'PUSH →',
  slide_up:    '↑ PUSH',
  slide_down:  '↓ PUSH',
}

interface TransitionPanelProps {
  onCut: () => void
  onAuto: () => void
  onFtb: () => void
  onSelectPvw: (mixerInput: string) => void
  onSetOvl: (alpha: number) => void
  className?: string
  visibleTransitions?: string[]
}

export function TransitionPanel({ onCut, onAuto, onFtb, onSelectPvw, onSetOvl, className, visibleTransitions }: TransitionPanelProps) {
  const ovlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedSetOvl = useCallback((alpha: number) => {
    if (ovlTimerRef.current) clearTimeout(ovlTimerRef.current)
    ovlTimerRef.current = setTimeout(() => onSetOvl(alpha), 150)
  }, [onSetOvl])

  const {
    pgmInput, pvwInput, isFtb,
    transitionType, transitionDurationMs, tBarPosition,
    setPgm, setTransitionType, setTransitionDuration, setTBarPosition,
    activeProductionId,
  } = useProductionStore()

  // Custom input keeps its own value; presets don't overwrite it
  const [customMs, setCustomMs] = useState(() =>
    DURATION_PRESETS_MS.includes(transitionDurationMs) ? 1500 : transitionDurationMs
  )
  const isCustomActive = !DURATION_PRESETS_MS.includes(transitionDurationMs)
  const [isEditingCustom, setIsEditingCustom] = useState(false)
  // Raw string while editing so clearing the field doesn't snap to 0
  const [editValue, setEditValue] = useState('')
  const customInputRef = useRef<HTMLInputElement>(null)

  // Exit edit mode whenever a preset is selected
  useEffect(() => {
    if (!isCustomActive) setIsEditingCustom(false)
  }, [isCustomActive])

  const handleCustomClick = () => {
    if (!isCustomActive) {
      // First click: select
      setTransitionDuration(customMs)
    } else if (!isEditingCustom) {
      // Second click: enter edit mode — seed string from current value
      setEditValue(String(customMs))
      setIsEditingCustom(true)
      setTimeout(() => { customInputRef.current?.select() }, 0)
    }
  }

  const commitEdit = () => {
    const parsed = parseInt(editValue, 10)
    if (!isNaN(parsed) && parsed >= 100 && parsed <= 10000) {
      setCustomMs(parsed)
      setTransitionDuration(parsed)
    }
    setIsEditingCustom(false)
  }

  const production = useProductionsStore((s) => s.productions.find((p) => p.id === activeProductionId))
  const sources = useSourcesStore((s) => s.sources)

  const VIRTUAL_SOURCE_NAMES: Record<string, string> = {
    '__test1__': 'PINWHEEL',
    '__test2__': 'COLORS',
  }

  // One slot per assignment, sorted by mixer input — handles duplicates and virtual sources
  const inputSlots = [...(production?.sources ?? [])]
    .sort((a, b) => a.mixerInput.localeCompare(b.mixerInput))
    .map((a) => {
      const realSource = sources.find((s) => s.id === a.sourceId)
      const name = (realSource?.name ?? VIRTUAL_SOURCE_NAMES[a.sourceId] ?? a.sourceId).toUpperCase()
      return { mixerInput: a.mixerInput, sourceId: a.sourceId, name }
    })

  return (
    <div className={cn("flex flex-col border border-zinc-800 bg-zinc-950 overflow-hidden", className)}>

      {/* ── PGM row ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 items-stretch border-b border-zinc-800" style={{ minHeight: 38 }}>
        {/* Row label */}
        <div className="flex items-center justify-center px-2 shrink-0 border-r border-zinc-800"
          style={{ width: 40, background: 'rgba(255,0,0,0.12)' }}>
          <span className="text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: '#ff0000' }}>PGM</span>
        </div>

        {/* Source tiles */}
        <div className="flex items-stretch gap-px flex-1 overflow-x-auto p-1">
          {inputSlots.length === 0 && (
            <span className="text-[9px] text-zinc-600 italic px-1 flex items-center">
              {!production?.templateId ? 'NO TEMPLATE' : 'NO SOURCES'}
            </span>
          )}
          {inputSlots.map((slot) => (
            <div
              key={slot.mixerInput}
              className={cn(
                'flex-1 min-w-14 px-1.5 text-[10px] font-bold truncate border cursor-default select-none flex items-center justify-center tracking-wide',
                pgmInput === slot.mixerInput
                  ? 'text-white border-white'
                  : 'text-zinc-600 border-zinc-800 bg-zinc-900',
              )}
              style={pgmInput === slot.mixerInput ? { background: '#ff0000', borderColor: '#ffffff' } : {}}
            >
              {slot.name}
            </div>
          ))}
        </div>

        {/* Action group: TAKE + AUTO + FTB */}
        <div className="flex items-stretch gap-px p-1 shrink-0 border-l border-zinc-800" style={{ width: 224 }}>
          {/* TAKE — large physical button */}
          <button
            onClick={onCut}
            className="btn-hardware flex-1 text-[11px] font-bold uppercase tracking-widest text-white border ring-1 ring-inset ring-white transition-opacity hover:opacity-90 cursor-pointer"
            style={{ background: '#cc0000', borderColor: '#ff0000' }}
          >
            TAKE
          </button>
          <button
            onClick={onAuto}
            className="btn-hardware flex-1 text-[10px] font-bold uppercase tracking-widest text-zinc-300 bg-zinc-800 border border-zinc-600 hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            AUTO
          </button>
          <button
            onClick={onFtb}
            className={cn(
              'btn-hardware flex-1 text-[10px] font-bold uppercase tracking-widest border transition-colors cursor-pointer',
              isFtb
                ? 'text-white border-zinc-400 bg-zinc-700'
                : 'text-zinc-500 bg-zinc-900 border-zinc-700 hover:text-zinc-300',
            )}
          >
            FTB
          </button>
        </div>
      </div>

      {/* ── PVW row ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 items-stretch border-b border-zinc-800" style={{ minHeight: 38 }}>
        {/* Row label */}
        <div className="flex items-center justify-center px-2 shrink-0 border-r border-zinc-800"
          style={{ width: 40, background: 'rgba(0,204,0,0.10)' }}>
          <span className="text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: '#00cc00' }}>PVW</span>
        </div>

        {/* Source tiles */}
        <div className="flex items-stretch gap-px flex-1 overflow-x-auto p-1">
          {inputSlots.length === 0 && (
            <span className="text-[9px] text-zinc-600 italic px-1 flex items-center">
              {!production?.templateId ? 'NO TEMPLATE' : 'NO SOURCES'}
            </span>
          )}
          {inputSlots.map((slot) => {
            const isOnPgm = pgmInput === slot.mixerInput
            const isActive = pvwInput === slot.mixerInput
            return (
              <button
                key={slot.mixerInput}
                onClick={() => !isOnPgm && onSelectPvw(slot.mixerInput)}
                disabled={isOnPgm}
                className={cn(
                  'btn-hardware flex-1 min-w-14 px-1.5 text-[10px] font-bold truncate border transition-all tracking-wide cursor-pointer',
                  isActive
                    ? 'text-black border-white'
                    : isOnPgm
                      ? 'text-zinc-700 bg-zinc-900 border-zinc-800 opacity-40 cursor-not-allowed'
                      : 'text-zinc-500 bg-zinc-900 border-zinc-800 hover:text-white hover:border-zinc-500',
                )}
                style={isActive ? { background: '#00cc00', borderColor: '#ffffff' } : {}}
              >
                {slot.name}
              </button>
            )
          })}
        </div>

        {/* Transition type selector */}
        <div className="flex items-stretch shrink-0 border-l border-zinc-800 p-1 gap-px" style={{ width: 224 }}>
          {TRANSITION_TYPES.filter((t) => !visibleTransitions || visibleTransitions.includes(t)).map((type) => (
            <button
              key={type}
              onClick={() => setTransitionType(type)}
              className={cn(
                'btn-hardware flex-1 text-[10px] font-bold uppercase tracking-widest border transition-colors cursor-pointer',
                transitionType === type
                  ? 'text-black bg-orange-500 border-orange-400'
                  : 'text-zinc-500 bg-zinc-900 border-zinc-700 hover:text-zinc-300 hover:bg-zinc-800',
              )}
            >
              {TRANSITION_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      {/* ── OVL / T-bar row ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 items-stretch">
        {/* Row label */}
        <div className="flex items-center justify-center px-2 shrink-0 border-r border-zinc-800" style={{ width: 40 }}>
          <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-600">OVL</span>
        </div>

        {/* T-bar slider — styled like a physical fader */}
        <div className="flex items-center flex-1 px-3 py-2 gap-3">
          <div className="relative flex-1 flex items-center" style={{ height: 24 }}>
            {/* Track background */}
            <div
              className="absolute inset-x-0"
              style={{
                height: 4,
                background: '#1a1a1a',
                border: '1px solid #333333',
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            />
            {/* Fill */}
            <div
              className="absolute left-0"
              style={{
                height: 4,
                width: `${tBarPosition * 100}%`,
                background: '#f97316',
                top: '50%',
                transform: 'translateY(-50%)',
                transition: 'width 40ms linear',
              }}
            />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(tBarPosition * 100)}
              onChange={(e) => { const v = Number(e.target.value) / 100; setTBarPosition(v); debouncedSetOvl(v) }}
              className="absolute inset-0 w-full opacity-0 cursor-pointer"
              style={{ zIndex: 2 }}
            />
          </div>
          <span className="text-[10px] font-mono text-zinc-500 w-10 text-right tabular-nums shrink-0">
            {tBarPosition.toFixed(2)}
          </span>
        </div>

        {/* Duration presets + custom ms input */}
        <div className="flex items-stretch gap-px p-1 shrink-0 border-l border-zinc-800" style={{ width: 224 }}>
          {DURATION_PRESETS_MS.map((ms) => (
            <button
              key={ms}
              onClick={() => setTransitionDuration(ms)}
              className={cn(
                'btn-hardware flex items-center justify-center gap-px border transition-colors shrink-0 cursor-pointer',
                transitionDurationMs === ms
                  ? 'text-black bg-orange-500 border-orange-400'
                  : 'text-zinc-500 bg-zinc-900 border-zinc-700 hover:text-zinc-300',
              )}
              style={{ width: 44 }}
            >
              <span className="text-[11px] font-mono font-bold leading-none">{ms / 1000}</span>
              <span className="text-[8px] font-mono leading-none mt-px">S</span>
            </button>
          ))}
          {/* Custom ms input — single click selects, second click edits */}
          <div
            onClick={handleCustomClick}
            className={cn(
              'flex items-center justify-center flex-1 border gap-0.5 px-1 transition-colors',
              isEditingCustom
                ? 'bg-zinc-800 border-white'
                : isCustomActive
                  ? 'bg-orange-500 border-orange-500'
                  : 'bg-zinc-900 border-zinc-700 hover:border-zinc-500 cursor-pointer',
            )}
          >
            <input
              ref={customInputRef}
              type="text"
              inputMode="numeric"
              value={isEditingCustom ? editValue : String(customMs)}
              readOnly={!isEditingCustom}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => { if (e.key === 'Enter') customInputRef.current?.blur() }}
              className={cn(
                'w-10 bg-transparent text-[11px] font-mono font-bold text-right focus:outline-none',
                isEditingCustom ? 'text-white cursor-text' : isCustomActive ? 'text-black cursor-pointer' : 'text-zinc-300 cursor-pointer',
              )}
            />
            <span className={cn(
              'text-[8px] font-mono uppercase shrink-0 mt-px pointer-events-none',
              isEditingCustom ? 'text-zinc-400' : isCustomActive ? 'text-black/70' : 'text-zinc-600',
            )}>MS</span>
          </div>
        </div>
      </div>

    </div>
  )
}
