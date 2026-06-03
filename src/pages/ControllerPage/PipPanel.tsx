import { useState, useRef, useCallback, useEffect } from 'react'
import { useProductionStore, type PipConfig, type PipZone, type SourceCrop, type PipTransforms } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { cn } from '@/lib/cn'

interface PipPanelProps {
  onApply: (pipIdx: number, config: PipConfig) => void
  className?: string
}

const ZONE_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ec4899']

const GRID_DIVISIONS = 9

function parsePgmResolution(val: unknown): { w: number; h: number } {
  if (typeof val === 'string') {
    const m = val.match(/^(\d+)x(\d+)$/)
    if (m) return { w: parseInt(m[1]!, 10), h: parseInt(m[2]!, 10) }
  }
  return { w: 1280, h: 720 }
}

function snapToGrid(v: number): number {
  return Math.round(v * GRID_DIVISIONS) / GRID_DIVISIONS
}

const HANDLE_POSITIONS: Record<string, React.CSSProperties> = {
  n:  { top: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' },
  ne: { top: -5, right: -5, cursor: 'ne-resize' },
  e:  { top: '50%', transform: 'translateY(-50%)', right: -5, cursor: 'e-resize' },
  se: { bottom: -5, right: -5, cursor: 'se-resize' },
  s:  { bottom: -5, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' },
  sw: { bottom: -5, left: -5, cursor: 'sw-resize' },
  w:  { top: '50%', transform: 'translateY(-50%)', left: -5, cursor: 'w-resize' },
  nw: { top: -5, left: -5, cursor: 'nw-resize' },
}
const HANDLES = Object.keys(HANDLE_POSITIONS) as Array<keyof typeof HANDLE_POSITIONS>

type DragState = {
  type: 'move' | 'resize'
  zoneIdx: number
  handle: string | null
  startX: number
  startY: number
  startRect: { x: number; y: number; w: number; h: number }
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

const EMPTY_CROP: SourceCrop = { left: 0, top: 0, right: 0, bottom: 0 }

function isCropZero(c: SourceCrop): boolean {
  return c.left < 1e-4 && c.top < 1e-4 && c.right < 1e-4 && c.bottom < 1e-4
}

function CropEditor({
  inputIdx,
  transforms,
  onChange,
}: {
  inputIdx: number
  transforms: PipTransforms
  onChange: (transforms: PipTransforms) => void
}) {
  const crop = transforms[inputIdx] ?? EMPTY_CROP

  const setCropField = (field: keyof SourceCrop, value: number) => {
    const next: SourceCrop = { ...crop, [field]: value }
    // Ensure at least 1% visible on each axis
    const maxL = Math.max(0, 1 - next.right - 0.01)
    const maxR = Math.max(0, 1 - next.left - 0.01)
    const maxT = Math.max(0, 1 - next.bottom - 0.01)
    const maxB = Math.max(0, 1 - next.top - 0.01)
    onChange({ ...transforms, [inputIdx]: {
      left:   clamp(next.left,   0, maxL),
      right:  clamp(next.right,  0, maxR),
      top:    clamp(next.top,    0, maxT),
      bottom: clamp(next.bottom, 0, maxB),
    }})
  }

  const resetCrop = () => {
    const next = { ...transforms }
    delete next[inputIdx]
    onChange(next)
  }

  const fields: Array<{ key: keyof SourceCrop; label: string }> = [
    { key: 'left', label: 'L' },
    { key: 'top', label: 'T' },
    { key: 'right', label: 'R' },
    { key: 'bottom', label: 'B' },
  ]

  return (
    <div className="flex flex-col gap-1.5 px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded-sm">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Crop / Zoom</span>
        {!isCropZero(crop) && (
          <button
            onClick={resetCrop}
            className="text-[9px] text-zinc-500 hover:text-orange-400 border border-zinc-700 hover:border-zinc-500 px-1 py-0.5 leading-none"
          >
            Reset
          </button>
        )}
      </div>
      {isCropZero(crop) ? (
        <span className="text-[9px] text-zinc-600 italic">No crop</span>
      ) : (
        <span className="text-[9px] text-zinc-400 font-mono">
          {fields.map(({ key, label }) => `${label} ${Math.round(crop[key] * 100)}%`).join('  ')}
        </span>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {fields.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-1.5">
            <span className="text-[9px] text-zinc-500 w-3 shrink-0">{label}</span>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={crop[key]}
              onChange={(e) => setCropField(key, parseFloat(e.target.value))}
              className="flex-1 h-1 accent-orange-500 cursor-pointer"
            />
            <span className="text-[9px] text-zinc-400 font-mono w-8 text-right shrink-0">
              {Math.round(crop[key] * 100)}%
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

export function PipPanel({ onApply, className }: PipPanelProps) {
  const { pgmPip, pvwPip, pips, activeProductionId } = useProductionStore()
  const production = useProductionsStore((s) => s.productions.find((p) => p.id === activeProductionId))
  const sources = useSourcesStore((s) => s.sources)

  const pgmResolution = parsePgmResolution(production?.values?.pgm_resolution)

  const [editingPipIdx, setEditingPipIdx] = useState(0)
  const [draft, setDraft] = useState<PipConfig>({ bg: null, zones: [], transforms: {} })
  const [selectedSourceIdx, setSelectedSourceIdx] = useState<number | null>(null)
  const [activeZoneIdx, setActiveZoneIdx] = useState(0)
  const [editMode, setEditMode] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(true)
  // Local string state for pixel coordinate inputs so mid-edit values aren't stomped
  const [pxInputs, setPxInputs] = useState<{ x: string; y: string; w: string; h: string } | null>(null)
  const isDirtyRef = useRef(false)
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset all editor state when the active production changes
  const prevProductionIdRef = useRef(activeProductionId)
  useEffect(() => {
    if (prevProductionIdRef.current === activeProductionId) return
    prevProductionIdRef.current = activeProductionId
    if (applyTimerRef.current) clearTimeout(applyTimerRef.current)
    isDirtyRef.current = false
    setEditingPipIdx(0)
    setActiveZoneIdx(0)
    setEditMode(false)
    setDraft({ bg: null, zones: [], transforms: {} })
    setSelectedSourceIdx(null)
  }, [activeProductionId])

  // Sync draft from server pips (only when not dirty)
  useEffect(() => {
    if (isDirtyRef.current) return
    const pip = pips[editingPipIdx]
    setDraft(pip ? structuredClone(pip) : { bg: null, zones: [], transforms: {} })
  }, [pips, editingPipIdx])

  // Reset zone selection only when switching PiP tabs
  const prevPipIdxRef = useRef(editingPipIdx)
  useEffect(() => {
    if (prevPipIdxRef.current !== editingPipIdx) {
      prevPipIdxRef.current = editingPipIdx
      setActiveZoneIdx(0)
    }
  }, [editingPipIdx])

  // Auto-apply: fire onApply 300ms after any draft change
  useEffect(() => {
    if (!isDirtyRef.current) return
    if (applyTimerRef.current) clearTimeout(applyTimerRef.current)
    applyTimerRef.current = setTimeout(() => {
      applyTimerRef.current = null
      isDirtyRef.current = false
      onApply(editingPipIdx, draft)
    }, 300)
    return () => {
      if (applyTimerRef.current) clearTimeout(applyTimerRef.current)
    }
  }, [draft, editingPipIdx, onApply])

  // Input slots: same pattern as TransitionPanel
  const VIRTUAL_SOURCE_NAMES: Record<string, string> = { '__test1__': 'PINWHEEL', '__test2__': 'COLORS' }
  const inputSlots = [...(production?.sources ?? [])]
    .sort((a, b) => a.mixerInput.localeCompare(b.mixerInput))
    .map((a, idx) => {
      const src = sources.find((s) => s.id === a.sourceId)
      const name = (src?.name ?? VIRTUAL_SOURCE_NAMES[a.sourceId] ?? a.sourceId).toUpperCase().slice(0, 8)
      return { idx, name }
    })

  const markDirty = () => { isDirtyRef.current = true }

  const isUsedAsBg = (idx: number) => draft.bg === idx
  const isInAnyZone = (idx: number) => draft.zones.some((z) => z.sources.includes(idx))
  const isInActiveZone = (idx: number) => (draft.zones[activeZoneIdx]?.sources ?? []).includes(idx)

  const toggleSource = (inputIdx: number) => {
    if (isUsedAsBg(inputIdx)) return
    markDirty()
    setDraft((prev) => {
      const next = structuredClone(prev)
      const zone = next.zones[activeZoneIdx]
      if (!zone) return prev
      const existingIdx = zone.sources.indexOf(inputIdx)
      if (existingIdx >= 0) {
        zone.sources.splice(existingIdx, 1)
      } else {
        // Remove from any other zone first (input can only be in one place)
        for (const z of next.zones) {
          const i = z.sources.indexOf(inputIdx)
          if (i >= 0) z.sources.splice(i, 1)
        }
        // FIFO evict if at capacity
        if (zone.capacity !== null && zone.sources.length >= zone.capacity) {
          zone.sources.shift()
        }
        zone.sources.push(inputIdx)
      }
      return next
    })
  }

  const handleSourceClick = (inputIdx: number) => {
    if (isUsedAsBg(inputIdx)) return
    if (draft.zones.length === 0) {
      // No zones yet — create a full-screen zone and add this source to it
      markDirty()
      setDraft((prev) => ({
        ...prev,
        zones: [{ rect: { x: 0, y: 0, w: 1, h: 1 }, capacity: null, sources: [inputIdx] }],
        transforms: prev.transforms ?? {},
      }))
      setActiveZoneIdx(0)
    } else {
      toggleSource(inputIdx)
    }
  }

  const setBg = (inputIdx: number | null) => {
    markDirty()
    setDraft((prev) => {
      const next = structuredClone(prev)
      if (inputIdx !== null) {
        for (const z of next.zones) {
          const i = z.sources.indexOf(inputIdx)
          if (i >= 0) z.sources.splice(i, 1)
        }
      }
      next.bg = inputIdx
      return next
    })
  }

  const addZone = () => {
    markDirty()
    const newIdx = draft.zones.length
    setDraft((prev) => {
      const next = structuredClone(prev)
      next.zones.push({ rect: { x: 0.55, y: 0.10, w: 0.42, h: 0.42 }, capacity: null, sources: [] })
      return next
    })
    setActiveZoneIdx(newIdx)
  }

  const removeZone = (zoneIdx: number) => {
    markDirty()
    setDraft((prev) => {
      const next = structuredClone(prev)
      next.zones.splice(zoneIdx, 1)
      return next
    })
    setActiveZoneIdx((prev) => Math.max(0, Math.min(prev, draft.zones.length - 2)))
  }

  const setZoneCapacity = (zoneIdx: number, cap: number | null) => {
    markDirty()
    setDraft((prev) => {
      const next = structuredClone(prev)
      const zone = next.zones[zoneIdx]
      if (!zone) return prev
      zone.capacity = cap
      if (cap !== null && zone.sources.length > cap) {
        zone.sources.splice(0, zone.sources.length - cap)
      }
      return next
    })
  }

  // Drag state
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const snapRef = useRef(snapEnabled)
  useEffect(() => { snapRef.current = snapEnabled }, [snapEnabled])

  const startDrag = useCallback((e: React.MouseEvent, zoneIdx: number, handle: string | null) => {
    e.stopPropagation()
    e.preventDefault()
    setActiveZoneIdx(zoneIdx)
    const zone = draft.zones[zoneIdx]
    if (!zone?.rect) return
    dragRef.current = {
      type: handle ? 'resize' : 'move',
      zoneIdx,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...zone.rect },
    }
  }, [draft.zones])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current
      const canvas = canvasRef.current
      if (!drag || !canvas) return
      const rect = canvas.getBoundingClientRect()
      const dx = (e.clientX - drag.startX) / rect.width
      const dy = (e.clientY - drag.startY) / rect.height
      const r = drag.startRect
      const snap = snapRef.current ? snapToGrid : (v: number) => v
      setDraft((prev) => {
        const next = structuredClone(prev)
        const zone = next.zones[drag.zoneIdx]
        if (!zone?.rect) return prev
        if (drag.type === 'move') {
          zone.rect.x = snap(clamp(r.x + dx, 0, 1 - zone.rect.w))
          zone.rect.y = snap(clamp(r.y + dy, 0, 1 - zone.rect.h))
        } else {
          const h = drag.handle ?? ''
          if (h.includes('e')) zone.rect.w = snap(clamp(r.w + dx, 0.05, 1 - zone.rect.x))
          if (h.includes('s')) zone.rect.h = snap(clamp(r.h + dy, 0.05, 1 - zone.rect.y))
          if (h.includes('w')) {
            const newX = snap(clamp(r.x + dx, 0, r.x + r.w - 0.05))
            zone.rect.w = r.x + r.w - newX
            zone.rect.x = newX
          }
          if (h.includes('n')) {
            const newY = snap(clamp(r.y + dy, 0, r.y + r.h - 0.05))
            zone.rect.h = r.y + r.h - newY
            zone.rect.y = newY
          }
        }
        return next
      })
      isDirtyRef.current = true
      setPxInputs(null)
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (pips.length === 0) {
    return (
      <div className="p-4 text-zinc-500 text-xs text-center">
        No PiP slots in this flow.
      </div>
    )
  }

  const flushPending = () => {
    if (isDirtyRef.current) {
      if (applyTimerRef.current) clearTimeout(applyTimerRef.current)
      onApply(editingPipIdx, draft)
      isDirtyRef.current = false
    }
  }

  return (
    <div className={cn('flex flex-col gap-2 p-2 border border-zinc-800 bg-zinc-950', className)}>
      {/* Header row: pip tabs + edit/done toggle */}
      <div className="flex items-center gap-1">
        {pips.length > 1 && pips.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              flushPending()
              setEditingPipIdx(i)
            }}
            className={cn(
              'px-2 py-0.5 text-[10px] font-bold border',
              editingPipIdx === i
                ? 'bg-orange-500 text-black border-orange-400'
                : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200',
            )}
          >
            PiP {i + 1}
          </button>
        ))}
        <button
          onClick={() => {
            flushPending()
            setEditMode((m) => !m)
          }}
          className={cn(
            'ml-auto px-2 py-0.5 text-[10px] font-bold border',
            editMode
              ? 'bg-zinc-700 text-zinc-200 border-zinc-500 hover:bg-zinc-600'
              : 'bg-zinc-900 text-zinc-500 border-zinc-700 hover:text-zinc-300',
          )}
        >
          {editMode ? 'Done' : 'Edit'}
        </button>
      </div>

      {editMode ? (
        /* ── EDIT MODE: canvas + zone management ── */
        <div className="flex gap-2">
          {/* Left column: canvas + pixel inputs */}
          <div className="flex flex-col shrink-0">
          {/* Zone canvas */}
          <div
            ref={canvasRef}
            className="relative select-none overflow-hidden"
            style={{ width: 420, aspectRatio: '16/9', background: '#111', border: '1px solid #3f3f46' }}
          >
            {draft.zones.map((zone, zIdx) => {
              const r = zone.rect ?? { x: 0, y: 0, w: 1, h: 1 }
              const isActive = zIdx === activeZoneIdx
              const color = ZONE_COLORS[zIdx % ZONE_COLORS.length]!
              return (
                <div
                  key={zIdx}
                  style={{
                    position: 'absolute',
                    left: `${r.x * 100}%`,
                    top: `${r.y * 100}%`,
                    width: `${r.w * 100}%`,
                    height: `${r.h * 100}%`,
                    border: `2px solid ${color}`,
                    background: isActive ? `${color}33` : `${color}11`,
                    cursor: 'move',
                    boxSizing: 'border-box',
                  }}
                  onMouseDown={(e) => startDrag(e, zIdx, null)}
                >
                  <div
                    style={{
                      position: 'absolute', top: 0, left: 0,
                      fontSize: 9, fontWeight: 700, padding: '1px 3px',
                      color, background: 'rgba(0,0,0,0.65)', lineHeight: 1.4,
                      pointerEvents: 'none',
                    }}
                  >
                    Z{zIdx + 1}{zone.sources.length > 0 ? `: ${zone.sources.map((s) => s + 1).join(',')}` : ''}
                  </div>
                  {zone.rect === null && (
                    <div style={{ position: 'absolute', inset: 0, border: '1px dashed', borderColor: color, margin: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 9, color, opacity: 0.7 }}>AUTO</span>
                    </div>
                  )}
                  {isActive && HANDLES.map((h) => (
                    <div
                      key={h}
                      style={{
                        position: 'absolute',
                        width: 8, height: 8,
                        background: color,
                        border: '1px solid rgba(0,0,0,0.5)',
                        ...HANDLE_POSITIONS[h],
                      }}
                      onMouseDown={(e) => startDrag(e, zIdx, h)}
                    />
                  ))}
                </div>
              )
            })}
            {/* 9×9 grid overlay — thirds are slightly brighter */}
            {snapEnabled && Array.from({ length: GRID_DIVISIONS - 1 }, (_, i) => i + 1).map((i) => (
              <div key={`v${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(i / GRID_DIVISIONS) * 100}%`, width: 1, background: i % 3 === 0 ? 'rgba(6,182,212,0.45)' : 'rgba(6,182,212,0.18)', pointerEvents: 'none' }} />
            ))}
            {snapEnabled && Array.from({ length: GRID_DIVISIONS - 1 }, (_, i) => i + 1).map((i) => (
              <div key={`h${i}`} style={{ position: 'absolute', left: 0, right: 0, top: `${(i / GRID_DIVISIONS) * 100}%`, height: 1, background: i % 3 === 0 ? 'rgba(6,182,212,0.45)' : 'rgba(6,182,212,0.18)', pointerEvents: 'none' }} />
            ))}
            {draft.bg !== null && (
              <div style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 8, color: '#a1a1aa', background: 'rgba(0,0,0,0.6)', padding: '1px 4px' }}>
                BG: {(inputSlots[draft.bg]?.name ?? String(draft.bg + 1))}
              </div>
            )}
            {draft.zones.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[10px] text-zinc-600">Click a source below to add a zone</span>
              </div>
            )}
          </div>

          {/* Pixel coordinate inputs for active zone */}
          {(() => {
            const activeZone = draft.zones[activeZoneIdx]
            const r = activeZone?.rect
            if (!r) return null
            const { w: pw, h: ph } = pgmResolution
            const toPixels = (n: number, dim: number) => Math.round(n * dim)
            const fromPixels = (px: number, dim: number) => clamp(px / dim, 0, 1)
            // Derive display values: use local string state while focused, else derive from rect
            const displayVal = (field: 'x' | 'y' | 'w' | 'h') => {
              if (pxInputs) return pxInputs[field]
              const dim = (field === 'x' || field === 'w') ? pw : ph
              return String(toPixels(r[field], dim))
            }
            const commitPxChange = (field: 'x' | 'y' | 'w' | 'h', raw: string) => {
              const px = parseInt(raw, 10)
              if (!Number.isFinite(px)) return
              markDirty()
              setDraft((prev) => {
                const next = structuredClone(prev)
                const zone = next.zones[activeZoneIdx]
                if (!zone?.rect) return prev
                const dim = (field === 'x' || field === 'w') ? pw : ph
                zone.rect[field] = fromPixels(px, dim)
                if (field === 'x') zone.rect.x = clamp(zone.rect.x, 0, 1 - zone.rect.w)
                if (field === 'y') zone.rect.y = clamp(zone.rect.y, 0, 1 - zone.rect.h)
                if (field === 'w') zone.rect.w = clamp(zone.rect.w, 1 / pw, 1 - zone.rect.x)
                if (field === 'h') zone.rect.h = clamp(zone.rect.h, 1 / ph, 1 - zone.rect.y)
                return next
              })
            }
            const initPxInputs = () => {
              setPxInputs({
                x: String(toPixels(r.x, pw)),
                y: String(toPixels(r.y, ph)),
                w: String(toPixels(r.w, pw)),
                h: String(toPixels(r.h, ph)),
              })
            }
            return (
              <div className="flex items-end gap-1 mt-1">
                {(['x', 'y', 'w', 'h'] as const).map((field) => (
                  <label key={field} className="flex flex-col items-center gap-0.5">
                    <span className="text-[8px] text-zinc-500 uppercase">{field}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={displayVal(field)}
                      onFocus={initPxInputs}
                      onChange={(e) => setPxInputs((prev) => prev ? { ...prev, [field]: e.target.value } : prev)}
                      onBlur={(e) => { commitPxChange(field, e.target.value); setPxInputs(null) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { commitPxChange(field, (e.target as HTMLInputElement).value); setPxInputs(null) } }}
                      className="w-14 bg-zinc-900 border border-zinc-700 text-zinc-200 text-[10px] text-center px-1 py-0.5 focus:outline-none focus:border-zinc-500"
                    />
                  </label>
                ))}
                <label className="flex flex-col items-center gap-0.5 ml-1">
                  <span className="text-[8px] text-zinc-500 uppercase">Snap</span>
                  <input
                    type="checkbox"
                    checked={snapEnabled}
                    onChange={(e) => setSnapEnabled(e.target.checked)}
                    className="w-[18px] h-[18px] accent-orange-500 cursor-pointer"
                  />
                </label>
              </div>
            )
          })()}
          </div>{/* end left column */}

          {/* Right panel: background + zone list */}
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            <div>
              <label className="text-[9px] text-zinc-500 uppercase tracking-wider block mb-0.5">Background</label>
              <select
                value={draft.bg ?? ''}
                onChange={(e) => { setBg(e.target.value === '' ? null : parseInt(e.target.value, 10)) }}
                className="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-[10px] px-1 py-0.5 focus:outline-none"
              >
                <option value="">None</option>
                {inputSlots.map((slot) => (
                  <option key={slot.idx} value={slot.idx} disabled={isInAnyZone(slot.idx)}>
                    {slot.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-0.5 flex-1 min-h-0">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] text-zinc-500 uppercase tracking-wider">Zones</span>
                <button
                  onClick={addZone}
                  className="text-[9px] px-1.5 py-0.5 bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-500"
                >
                  + Add
                </button>
              </div>
              <div className="flex flex-col gap-0.5">
                {draft.zones.map((zone, zIdx) => {
                  const color = ZONE_COLORS[zIdx % ZONE_COLORS.length]!
                  return (
                    <div
                      key={zIdx}
                      className={cn(
                        'flex items-center gap-0.5 px-1 py-0.5 border cursor-pointer',
                        zIdx === activeZoneIdx ? 'border-orange-500 bg-zinc-800' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600',
                      )}
                      onClick={() => setActiveZoneIdx(zIdx)}
                    >
                      <div style={{ width: 6, height: 6, background: color, borderRadius: 1, flexShrink: 0 }} />
                      <span className="text-[9px] text-zinc-400 font-bold">Z{zIdx + 1}</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="∞"
                        value={zone.capacity ?? ''}
                        onChange={(e) => {
                          e.stopPropagation()
                          const v = e.target.value === '' ? null : parseInt(e.target.value, 10)
                          setZoneCapacity(zIdx, Number.isFinite(v) ? v : null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-6 bg-transparent border-0 text-zinc-300 text-[9px] text-center focus:outline-none"
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); removeZone(zIdx) }}
                        className="ml-auto text-[9px] text-zinc-600 hover:text-red-400 leading-none px-0.5"
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── VIEW MODE: zone selector only ── */
        draft.zones.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {draft.zones.map((zone, zIdx) => {
              const color = ZONE_COLORS[zIdx % ZONE_COLORS.length]!
              const sourceNames = zone.sources.map((s) => inputSlots[s]?.name ?? String(s + 1))
              return (
                <div
                  key={zIdx}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 border cursor-pointer',
                    zIdx === activeZoneIdx ? 'border-orange-500 bg-zinc-800' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600',
                  )}
                  onClick={() => setActiveZoneIdx(zIdx)}
                >
                  <div style={{ width: 8, height: 8, background: color, borderRadius: 1, flexShrink: 0 }} />
                  <span className="text-[10px] font-bold" style={{ color }}>Z{zIdx + 1}</span>
                  {zone.capacity !== null && (
                    <span className="text-[9px] text-zinc-500">{zone.sources.length}/{zone.capacity}</span>
                  )}
                  <div className="flex gap-0.5 flex-wrap ml-1">
                    {sourceNames.map((name, i) => (
                      <span key={i} className="text-[9px] bg-zinc-700 text-zinc-200 px-1 py-0.5">{name}</span>
                    ))}
                    {sourceNames.length === 0 && (
                      <span className="text-[9px] text-zinc-600 italic">empty</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="py-2 text-center text-[10px] text-zinc-600">
            Click a source below to fill this PiP
          </div>
        )
      )}

      {/* Source chips — always visible */}
      <div>
        <span className="text-[9px] text-zinc-500 uppercase tracking-wider block mb-1">
          {editMode
            ? (draft.zones.length === 0 ? 'Sources' : `Sources → Zone ${activeZoneIdx + 1}`)
            : (draft.zones.length === 0 ? 'Sources' : `Sources → Zone ${activeZoneIdx + 1}`)}
        </span>
        <div className="flex flex-wrap gap-1">
          {inputSlots.map((slot) => {
            const inActive = isInActiveZone(slot.idx)
            const asBg = isUsedAsBg(slot.idx)
            const inOther = !inActive && !asBg && isInAnyZone(slot.idx)
            const isSelected = selectedSourceIdx === slot.idx
            const hasCrop = !isCropZero(draft.transforms?.[slot.idx] ?? EMPTY_CROP)
            return (
              <button
                key={slot.idx}
                onClick={() => {
                  handleSourceClick(slot.idx)
                  setSelectedSourceIdx((prev) => prev === slot.idx ? null : slot.idx)
                }}
                disabled={asBg}
                className={cn(
                  'px-1.5 py-0.5 text-[10px] font-bold border relative',
                  inActive
                    ? 'bg-orange-500 text-black border-orange-400'
                    : asBg
                      ? 'bg-zinc-800 text-zinc-600 border-zinc-700 cursor-not-allowed'
                      : inOther
                        ? 'bg-zinc-900 text-zinc-600 border-zinc-700 italic'
                        : isSelected
                          ? 'bg-zinc-700 text-zinc-200 border-zinc-500'
                          : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500 hover:text-white',
                )}
              >
                {slot.name}
                {hasCrop && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-orange-500 border border-zinc-950" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Crop / Zoom editor — shown when a source chip is selected */}
      {selectedSourceIdx !== null && !isUsedAsBg(selectedSourceIdx) && (
        <CropEditor
          inputIdx={selectedSourceIdx}
          transforms={draft.transforms ?? {}}
          onChange={(transforms) => {
            markDirty()
            setDraft((prev) => ({ ...prev, transforms }))
          }}
        />
      )}
    </div>
  )
}
