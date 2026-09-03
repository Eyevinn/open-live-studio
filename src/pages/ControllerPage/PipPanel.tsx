import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useProductionStore, type PipConfig, type SourceCrop, type PipTransforms, type ZoneBorder } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { cn } from '@/lib/cn'
import { Tooltip } from '@/components/ui/Tooltip'

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
  return { w: 1920, h: 1080 }
}

function snapToGrid(v: number): number {
  return Math.round(v * GRID_DIVISIONS) / GRID_DIVISIONS
}

// Handle anchors as fractions within the zone rect (xFrac, yFrac)
const HANDLE_ANCHORS: Record<string, { xFrac: number; yFrac: number; cursor: string }> = {
  n:  { xFrac: 0.5, yFrac: 0,   cursor: 'n-resize' },
  ne: { xFrac: 1,   yFrac: 0,   cursor: 'ne-resize' },
  e:  { xFrac: 1,   yFrac: 0.5, cursor: 'e-resize' },
  se: { xFrac: 1,   yFrac: 1,   cursor: 'se-resize' },
  s:  { xFrac: 0.5, yFrac: 1,   cursor: 's-resize' },
  sw: { xFrac: 0,   yFrac: 1,   cursor: 'sw-resize' },
  w:  { xFrac: 0,   yFrac: 0.5, cursor: 'w-resize' },
  nw: { xFrac: 0,   yFrac: 0,   cursor: 'nw-resize' },
}
const HANDLES = Object.keys(HANDLE_ANCHORS)

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

type CropRect = { x: number; y: number; w: number; h: number } // in source pixels
type CropDrag =
  | { kind: 'move';   startRect: CropRect; startMx: number; startMy: number }
  | { kind: 'resize'; handle: string; startRect: CropRect; startMx: number; startMy: number; lockedAspect: number | null }

/** Convert SourceCrop fractions → pixel rect (visible window in source pixels). */
function cropToRect(c: SourceCrop, srcW: number, srcH: number): CropRect {
  const x = Math.round(c.left * srcW)
  const y = Math.round(c.top * srcH)
  const w = Math.round((1 - c.left - c.right) * srcW)
  const h = Math.round((1 - c.top - c.bottom) * srcH)
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) }
}

/** Convert pixel rect → SourceCrop fractions, clamped to valid range. */
function rectToCrop(r: CropRect, srcW: number, srcH: number): SourceCrop {
  const w = Math.max(1, Math.min(r.w, srcW))
  const h = Math.max(1, Math.min(r.h, srcH))
  const x = Math.max(0, Math.min(r.x, srcW - w))
  const y = Math.max(0, Math.min(r.y, srcH - h))
  return {
    left:   x / srcW,
    top:    y / srcH,
    right:  (srcW - x - w) / srcW,
    bottom: (srcH - y - h) / srcH,
  }
}

const CROP_HANDLES = ['n','ne','e','se','s','sw','w','nw'] as const
const CROP_HANDLE_ANCHORS: Record<string, { xFrac: number; yFrac: number; cursor: string }> = {
  n:  { xFrac: 0.5, yFrac: 0,   cursor: 'n-resize' },
  ne: { xFrac: 1,   yFrac: 0,   cursor: 'ne-resize' },
  e:  { xFrac: 1,   yFrac: 0.5, cursor: 'e-resize' },
  se: { xFrac: 1,   yFrac: 1,   cursor: 'se-resize' },
  s:  { xFrac: 0.5, yFrac: 1,   cursor: 's-resize' },
  sw: { xFrac: 0,   yFrac: 1,   cursor: 'sw-resize' },
  w:  { xFrac: 0,   yFrac: 0.5, cursor: 'w-resize' },
  nw: { xFrac: 0,   yFrac: 0,   cursor: 'nw-resize' },
}

function CropEditor({
  inputIdx,
  transforms,
  onChange,
  srcW = 1920,
  srcH = 1080,
  headerSlot,
  className,
  canvasStyle,
  lockAspect,
  controlsContainer,
  layout,
}: {
  inputIdx: number
  transforms: PipTransforms
  onChange: (transforms: PipTransforms) => void
  srcW?: number
  srcH?: number
  headerSlot?: React.ReactNode
  className?: string
  canvasStyle?: React.CSSProperties
  lockAspect?: number
  controlsContainer?: Element | null
  layout?: (parts: { header: React.ReactNode; canvas: React.ReactNode; zoom: React.ReactNode; controls: React.ReactNode }) => React.ReactNode
}) {
  const crop = transforms[inputIdx] ?? EMPTY_CROP
  const rect = useMemo(() => cropToRect(crop, srcW, srcH), [crop, srcW, srcH])

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef   = useRef<CropDrag | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const snapRef   = useRef(true)
  useEffect(() => { snapRef.current = snapEnabled }, [snapEnabled])
  const [aspectLocked, setAspectLocked] = useState(false)
  const aspectLockRef = useRef(false)
  useEffect(() => { aspectLockRef.current = aspectLocked }, [aspectLocked])

  // Local string state for the X/Y/W/H inputs while editing
  const [pxEdit, setPxEdit] = useState<Partial<Record<'x'|'y'|'w'|'h', string>>>({})

  const commit = useCallback((r: CropRect) => {
    const next = rectToCrop(r, srcW, srcH)
    if (isCropZero(next)) {
      const t = { ...transforms }; delete t[inputIdx]; onChange(t)
    } else {
      onChange({ ...transforms, [inputIdx]: next })
    }
  }, [transforms, inputIdx, onChange, srcW, srcH])

  // Crop box as percentages of source dimensions (for responsive canvas)
  const boxLP = (rect.x / srcW) * 100
  const boxTP = (rect.y / srcH) * 100
  const boxWP = (rect.w / srcW) * 100
  const boxHP = (rect.h / srcH) * 100

  const startDrag = useCallback((e: React.MouseEvent, kind: 'move' | 'resize', handle = '') => {
    e.stopPropagation(); e.preventDefault()
    dragRef.current = {
      kind: kind === 'resize' ? 'resize' : 'move',
      handle,
      startRect: { ...rect },
      startMx: e.clientX,
      startMy: e.clientY,
      lockedAspect: aspectLockRef.current ? rect.w / rect.h : null,
    } as CropDrag
  }, [rect])

  const snapPx = useCallback((v: number, gridSize: number) =>
    snapRef.current ? Math.round(v / gridSize) * gridSize : v
  , [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current
      const canvas = canvasRef.current
      if (!drag || !canvas) return
      // Compute scale from actual rendered size so drag works at any canvas width
      const bounds = canvas.getBoundingClientRect()
      const scaleX = bounds.width / srcW
      const scaleY = bounds.height / srcH
      const dx = (e.clientX - drag.startMx) / scaleX
      const dy = (e.clientY - drag.startMy) / scaleY
      const r = { ...drag.startRect }
      const locked = drag.kind === 'resize' ? drag.lockedAspect : null
      const gx = srcW / GRID_DIVISIONS
      const gy = srcH / GRID_DIVISIONS

      if (drag.kind === 'move') {
        r.x = snapPx(clamp(r.x + dx, 0, srcW - r.w), gx)
        r.y = snapPx(clamp(r.y + dy, 0, srcH - r.h), gy)
      } else {
        const h = drag.handle
        if (h.includes('e')) {
          if (locked) {
            const maxW = Math.min(srcW - r.x, Math.floor((srcH - r.y) * locked))
            r.w = snapPx(clamp(r.w + dx, 10, maxW), gx)
            r.h = Math.round(r.w / locked)
          } else {
            r.w = snapPx(clamp(r.w + dx, 10, srcW - r.x), gx)
          }
        }
        if (h.includes('s')) {
          if (locked) {
            const maxH = Math.min(srcH - r.y, Math.floor((srcW - r.x) / locked))
            r.h = snapPx(clamp(r.h + dy, 10, maxH), gy)
            r.w = Math.round(r.h * locked)
          } else {
            r.h = snapPx(clamp(r.h + dy, 10, srcH - r.y), gy)
          }
        }
        if (h.includes('w')) {
          if (locked) {
            const maxDx = r.x + r.w - 10
            const newX = snapPx(clamp(r.x + dx, 0, maxDx), gx)
            const newW = Math.min(r.x + r.w - newX, Math.floor((srcH - r.y) * locked))
            r.x = r.x + r.w - newW; r.w = newW
            r.h = Math.round(r.w / locked)
          } else {
            const newX = snapPx(clamp(r.x + dx, 0, r.x + r.w - 10), gx)
            r.w = r.x + r.w - newX; r.x = newX
          }
        }
        if (h.includes('n')) {
          if (locked) {
            const maxDy = r.y + r.h - 10
            const newY = snapPx(clamp(r.y + dy, 0, maxDy), gy)
            const newH = Math.min(r.y + r.h - newY, Math.floor((srcW - r.x) / locked))
            r.y = r.y + r.h - newH; r.h = newH
            r.w = Math.round(r.h * locked)
          } else {
            const newY = snapPx(clamp(r.y + dy, 0, r.y + r.h - 10), gy)
            r.h = r.y + r.h - newY; r.y = newY
          }
        }
      }
      commit(r)
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [commit, snapPx, srcW, srcH])

  const resetCrop = () => {
    const t = { ...transforms }; delete t[inputIdx]; onChange(t)
  }

  // Zoom: width fraction of source (1 = no zoom, lower = zoomed in)
  const zoomFrac = clamp(1 - crop.left - crop.right, 0.05, 1)
  // When locked, max zoom-out is where the height would hit the source boundary
  const maxZoomFrac = aspectLocked ? Math.min(1, (rect.w * srcH) / (rect.h * srcW)) : 1
  const handleZoom = (newZoomFrac: number) => {
    const curW = 1 - crop.left - crop.right
    const curH = 1 - crop.top - crop.bottom
    const scale = newZoomFrac / curW
    const newW = Math.min(newZoomFrac, maxZoomFrac)
    const newH = aspectLocked ? newW * (curH / curW) : clamp(curH * scale, 0.05, 1)
    const cx = crop.left + curW / 2
    const cy = crop.top + curH / 2
    const newL = clamp(cx - newW / 2, 0, 1 - newW)
    const newT = clamp(cy - newH / 2, 0, 1 - newH)
    commit({
      x: Math.round(newL * srcW),
      y: Math.round(newT * srcH),
      w: Math.round(newW * srcW),
      h: Math.round(newH * srcH),
    })
  }

  // X/Y/W/H pixel inputs
  const commitField = (field: 'x'|'y'|'w'|'h', raw: string) => {
    const v = parseInt(raw, 10)
    if (!Number.isFinite(v)) return
    const r = { ...rect, [field]: v }
    if (field === 'w' && aspectLocked) r.h = Math.round(v / (rect.w / rect.h))
    if (field === 'h' && aspectLocked) r.w = Math.round(v * (rect.w / rect.h))
    commit(r)
  }

  const fieldVal = (f: 'x'|'y'|'w'|'h') => pxEdit[f] ?? String(rect[f])

  const controls = (
    <div className="flex items-end gap-1 w-full">
      {(['x','y','w','h'] as const).map((f) => (
        <label key={f} className="flex flex-col items-center gap-0.5 flex-1">
          <span className="text-[8px] text-zinc-500 uppercase">{f}</span>
          <input
            type="text"
            inputMode="numeric"
            value={fieldVal(f)}
            onFocus={() => setPxEdit((p) => ({ ...p, [f]: String(rect[f]) }))}
            onChange={(e) => setPxEdit((p) => ({ ...p, [f]: e.target.value }))}
            onBlur={(e) => { commitField(f, e.target.value); setPxEdit((p) => { const n={...p}; delete n[f]; return n }) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { commitField(f, (e.target as HTMLInputElement).value); setPxEdit((p) => { const n={...p}; delete n[f]; return n }) }}}
            className="w-full bg-zinc-950 border border-zinc-700 text-zinc-200 text-[10px] text-center px-0.5 py-0.5 focus:outline-none focus:border-zinc-500"
          />
        </label>
      ))}
      <label className="flex flex-col items-center gap-0.5 shrink-0 cursor-pointer select-none">
        <span className="text-[8px] text-zinc-500 uppercase">Lock</span>
        <input
          type="checkbox"
          checked={aspectLocked}
          onChange={(e) => {
            const locking = e.target.checked
            setAspectLocked(locking)
            if (locking) {
              const selAspect = lockAspect ?? ((rect.w / rect.h) || (16 / 9))
              let newW = rect.w
              let newH = Math.round(newW / selAspect)
              if (newH > srcH) { newH = srcH; newW = Math.round(srcH * selAspect) }
              if (newW > srcW) { newW = srcW; newH = Math.round(srcW / selAspect) }
              commit({ x: Math.round((srcW - newW) / 2), y: Math.round((srcH - newH) / 2), w: newW, h: newH })
            }
          }}
          className="w-[18px] h-[18px] accent-orange-500 cursor-pointer"
        />
      </label>
      <label className="flex flex-col items-center gap-0.5 shrink-0 cursor-pointer select-none">
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

  const headerEl = (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-zinc-500 uppercase tracking-wider shrink-0">Crop / Zoom</span>
      <div className="flex-1 min-w-0">{headerSlot}</div>
      <button
        onClick={resetCrop}
        className="px-2 py-0.5 text-[10px] font-bold border border-zinc-700 text-zinc-500 hover:text-orange-400 hover:border-zinc-500 shrink-0"
      >
        Reset
      </button>
    </div>
  )

  const canvasEl = (
    <div
      ref={canvasRef}
      className="relative select-none w-full"
      style={{ aspectRatio: `${srcW}/${srcH}`, background: '#0a0a0a', outline: '1px solid #3f3f46', overflow: 'visible', ...canvasStyle }}
    >
        {/* Masked (cropped-out) overlay — four rects */}
        <div style={{ position:'absolute', top:0, left:0, width:`${boxLP}%`, bottom:0, background:'rgba(0,0,0,0.55)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:0, right:0, width:`${100-boxLP-boxWP}%`, bottom:0, background:'rgba(0,0,0,0.55)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:0, left:`${boxLP}%`, width:`${boxWP}%`, height:`${boxTP}%`, background:'rgba(0,0,0,0.55)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:0, left:`${boxLP}%`, width:`${boxWP}%`, height:`${100-boxTP-boxHP}%`, background:'rgba(0,0,0,0.55)', pointerEvents:'none' }} />

        {/* Grid overlay — rendered after masked overlays so lines are visible everywhere */}
        {Array.from({ length: GRID_DIVISIONS - 1 }, (_, i) => i + 1).map((i) => (
          <div key={`cv${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(i / GRID_DIVISIONS) * 100}%`, width: 1, background: i % 3 === 0 ? 'rgba(6,182,212,0.45)' : 'rgba(6,182,212,0.18)', pointerEvents: 'none' }} />
        ))}
        {Array.from({ length: GRID_DIVISIONS - 1 }, (_, i) => i + 1).map((i) => (
          <div key={`ch${i}`} style={{ position: 'absolute', left: 0, right: 0, top: `${(i / GRID_DIVISIONS) * 100}%`, height: 1, background: i % 3 === 0 ? 'rgba(6,182,212,0.45)' : 'rgba(6,182,212,0.18)', pointerEvents: 'none' }} />
        ))}

        {/* Crop box */}
        <div
          style={{
            position: 'absolute',
            left: `${boxLP}%`, top: `${boxTP}%`, width: `${boxWP}%`, height: `${boxHP}%`,
            border: '2px solid #f97316',
            background: 'rgba(249,115,22,0.2)',
            boxSizing: 'border-box',
            cursor: 'move',
          }}
          onMouseDown={(e) => startDrag(e, 'move')}
        />

        {/* Resize handles */}
        {CROP_HANDLES.map((h) => {
          const anchor = CROP_HANDLE_ANCHORS[h]!
          return (
            <div
              key={h}
              style={{
                position: 'absolute',
                left: `${boxLP + anchor.xFrac * boxWP}%`,
                top: `${boxTP + anchor.yFrac * boxHP}%`,
                transform: 'translate(-50%, -50%)',
                width: 8, height: 8,
                background: '#f97316',
                border: '1px solid rgba(0,0,0,0.5)',
                cursor: anchor.cursor,
                zIndex: 10,
              }}
              onMouseDown={(e) => startDrag(e, 'resize', h)}
            />
          )
        })}

        {/* Size label inside box */}
        <div style={{
          position:'absolute', left:`${boxLP}%`, top:`${boxTP}%`,
          margin: '2px 0 0 2px',
          fontSize: 8, color: '#f97316', background:'rgba(0,0,0,0.6)', padding:'1px 3px', pointerEvents:'none',
        }}>
          {rect.w}×{rect.h}
        </div>
      </div>
  )

  const zoomEl = (
    <label className="flex items-center gap-2">
      <span className="text-[9px] text-zinc-500 w-8 shrink-0">Zoom</span>
      <input
        type="range"
        min={1.05 - maxZoomFrac}
        max={1}
        step={0.01}
        value={1.05 - zoomFrac}
        onChange={(e) => handleZoom(1.05 - parseFloat(e.target.value))}
        className="flex-1 h-1 accent-orange-500 cursor-pointer"
      />
      <span className="text-[9px] text-zinc-400 font-mono w-8 text-right shrink-0">
        {zoomFrac < 0.999 ? `${Math.round(1 / zoomFrac * 10) / 10}×` : '1×'}
      </span>
    </label>
  )

  if (layout) return <>{layout({ header: headerEl, canvas: canvasEl, zoom: zoomEl, controls })}</>

  return (
    <>
    <div className={className ?? 'flex flex-col gap-2 p-2 bg-zinc-900 border border-zinc-700'}>
      {headerEl}
      {canvasEl}
      {zoomEl}
      {controlsContainer == null && controls}
    </div>
    {controlsContainer != null && createPortal(controls, controlsContainer)}
  </>
  )
}

export function PipPanel({ onApply, className }: PipPanelProps) {
  const { pips, activeProductionId } = useProductionStore()
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
      const name = (src?.name ?? VIRTUAL_SOURCE_NAMES[a.sourceId] ?? a.sourceId).toUpperCase()
      return { idx, name }
    })

  const markDirty = () => { isDirtyRef.current = true }

  // Derive the effective crop/zoom source: follow the active zone's first source unless
  // the user has explicitly picked a source that's still in the active zone.
  const activeZoneSources = draft.zones[activeZoneIdx]?.sources ?? []
  const cropSourceIdx: number | null =
    selectedSourceIdx !== null && activeZoneSources.includes(selectedSourceIdx)
      ? selectedSourceIdx
      : (activeZoneSources[0] ?? null)

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
      next.zones.push({ rect: { x: 5/9, y: 1/9, w: 4/9, h: 4/9 }, capacity: null, sources: [] })
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

  const setZoneBorder = (zoneIdx: number, border: ZoneBorder | undefined) => {
    markDirty()
    setDraft((prev) => {
      const next = structuredClone(prev)
      const zone = next.zones[zoneIdx]
      if (!zone) return prev
      zone.border = border
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

  const sourceChips = (
    <div>
      <span className="text-[9px] text-zinc-500 uppercase tracking-wider block mb-1">
        {draft.zones.length === 0 ? 'Sources' : `Sources → Zone ${activeZoneIdx + 1}`}
      </span>
      <div className="flex flex-wrap gap-1">
        {inputSlots.map((slot) => {
          const inActive = isInActiveZone(slot.idx)
          const asBg = isUsedAsBg(slot.idx)
          const inOther = !inActive && !asBg && isInAnyZone(slot.idx)
          return (
            <button
              key={slot.idx}
              onClick={() => handleSourceClick(slot.idx)}
              disabled={asBg}
              className={cn(
                'px-1.5 py-0.5 text-[10px] font-bold border',
                inActive
                  ? 'bg-orange-500 text-black border-orange-400'
                  : asBg
                    ? 'bg-zinc-800 text-zinc-600 border-zinc-700 cursor-not-allowed'
                    : inOther
                      ? 'bg-zinc-900 text-zinc-600 border-zinc-700 italic'
                      : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500 hover:text-white',
              )}
            >
              {slot.name}
            </button>
          )
        })}
      </div>
    </div>
  )

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
        /* ── EDIT MODE ── */
        <div className="flex flex-col gap-2">
        {/* Zone editor box */}
        <div className="flex flex-col gap-2 p-2 bg-zinc-900 border border-zinc-700">
          {sourceChips}

          {/* Row 1: zone canvas + bg/zones sidebar */}
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <div
                ref={canvasRef}
                className="relative select-none w-full"
                style={{ aspectRatio: '16/9', background: '#0a0a0a', outline: '1px solid #3f3f46', overflow: 'visible' }}
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
                    </div>
                  )
                })}
                {Array.from({ length: GRID_DIVISIONS - 1 }, (_, i) => i + 1).map((i) => (
                  <div key={`v${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(i / GRID_DIVISIONS) * 100}%`, width: 1, background: i % 3 === 0 ? 'rgba(6,182,212,0.45)' : 'rgba(6,182,212,0.18)', pointerEvents: 'none' }} />
                ))}
                {Array.from({ length: GRID_DIVISIONS - 1 }, (_, i) => i + 1).map((i) => (
                  <div key={`h${i}`} style={{ position: 'absolute', left: 0, right: 0, top: `${(i / GRID_DIVISIONS) * 100}%`, height: 1, background: i % 3 === 0 ? 'rgba(6,182,212,0.45)' : 'rgba(6,182,212,0.18)', pointerEvents: 'none' }} />
                ))}
                {(() => {
                  const activeZone = draft.zones[activeZoneIdx]
                  const r = activeZone?.rect
                  if (!r) return null
                  const color = ZONE_COLORS[activeZoneIdx % ZONE_COLORS.length]!
                  return HANDLES.map((h) => {
                    const anchor = HANDLE_ANCHORS[h]!
                    return (
                      <div
                        key={h}
                        style={{
                          position: 'absolute',
                          left: `${(r.x + anchor.xFrac * r.w) * 100}%`,
                          top: `${(r.y + anchor.yFrac * r.h) * 100}%`,
                          transform: 'translate(-50%, -50%)',
                          width: 8, height: 8,
                          background: color,
                          border: '1px solid rgba(0,0,0,0.5)',
                          cursor: anchor.cursor,
                          zIndex: 20,
                        }}
                        onMouseDown={(e) => startDrag(e, activeZoneIdx, h)}
                      />
                    )
                  })
                })()}
                {draft.bg !== null && (
                  <div style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 8, color: '#a1a1aa', background: 'rgba(0,0,0,0.6)', padding: '1px 4px' }}>
                    BG: {(inputSlots[draft.bg]?.name ?? String(draft.bg + 1))}
                  </div>
                )}
                {draft.zones.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[10px] text-zinc-600">Click a source above to add a zone</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right panel: background + zone list — fixed width */}
            <div className="flex flex-col gap-2 w-36 shrink-0">
              <div>
                <Tooltip content="Source to display as the PiP frame background"><label className="text-[9px] text-zinc-500 uppercase tracking-wider block mb-0.5">Background</label></Tooltip>
                <select
                  value={draft.bg ?? ''}
                  onChange={(e) => { setBg(e.target.value === '' ? null : parseInt(e.target.value, 10)) }}
                  className="w-full bg-zinc-950 border border-zinc-700 text-zinc-200 text-[10px] px-1 py-0.5 focus:outline-none"
                >
                  <option value="">None</option>
                  {inputSlots.map((slot) => (
                    <option key={slot.idx} value={slot.idx} disabled={isInAnyZone(slot.idx)}>
                      {slot.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between mb-0.5">
                  <Tooltip content="Define where sources appear within the PiP frame"><span className="text-[9px] text-zinc-500 uppercase tracking-wider">Zones</span></Tooltip>
                  <button
                    onClick={addZone}
                    className="text-[9px] px-1.5 py-0.5 bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-500"
                  >
                    + Add
                  </button>
                </div>
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

          {/* Row 2: zone x/y/w/h inputs — full width */}
          {(() => {
            const activeZone = draft.zones[activeZoneIdx]
            const r = activeZone?.rect
            if (!r) return null
            const { w: pw, h: ph } = pgmResolution
            const toPixels = (n: number, dim: number) => Math.round(n * dim)
            const fromPixels = (px: number, dim: number) => clamp(px / dim, 0, 1)
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
              <div className="flex items-stretch gap-1 w-full">
                {(['x', 'y', 'w', 'h'] as const).map((field) => (
                  <label key={field} className="flex flex-col items-center justify-end gap-0.5 flex-1">
                    <span className="text-[8px] text-zinc-500 uppercase">{field}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={displayVal(field)}
                      onFocus={initPxInputs}
                      onChange={(e) => setPxInputs((prev) => prev ? { ...prev, [field]: e.target.value } : prev)}
                      onBlur={(e) => { commitPxChange(field, e.target.value); setPxInputs(null) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { commitPxChange(field, (e.target as HTMLInputElement).value); setPxInputs(null) } }}
                      className="w-full bg-zinc-950 border border-zinc-700 text-zinc-200 text-[10px] text-center px-0.5 py-0.5 focus:outline-none focus:border-zinc-500"
                    />
                  </label>
                ))}
                {/* Border color + width */}
                {(() => {
                  const border = draft.zones[activeZoneIdx]?.border
                  const color = border?.color ?? '#ffffff'
                  const width = border?.width ?? 0
                  const commitWidth = (raw: string) => {
                    const w = Math.max(0, Math.min(64, parseFloat(raw) || 0))
                    setZoneBorder(activeZoneIdx, w > 0 ? { color, width: w } : undefined)
                  }
                  return (
                    <>
                      <label className="flex flex-col items-center justify-end gap-0.5 shrink-0 cursor-pointer select-none">
                        <span className="text-[8px] text-zinc-500 uppercase">Border</span>
                        <input
                          type="color"
                          defaultValue={color.slice(0, 7)}
                          key={activeZoneIdx}
                          onChange={(e) => {
                            const hex = e.target.value
                            const alpha = border?.color && border.color.length === 9 ? border.color.slice(7) : ''
                            setZoneBorder(activeZoneIdx, { color: hex + alpha, width })
                          }}
                          className="cursor-pointer border border-zinc-700 p-0 block w-8 h-[19.25px]"
                          style={{ borderRadius: 0, WebkitAppearance: 'none', appearance: 'none' }}
                        />
                      </label>
                      <label className="flex flex-col items-center justify-end gap-0.5 shrink-0">
                        <span className="text-[8px] text-zinc-500 uppercase">Width</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          defaultValue={width}
                          key={`border-w-${activeZoneIdx}`}
                          onBlur={(e) => commitWidth(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitWidth((e.target as HTMLInputElement).value) }}
                          className="w-8 bg-zinc-950 border border-zinc-700 text-zinc-200 text-[10px] text-center px-0.5 py-0.5 focus:outline-none focus:border-zinc-500"
                        />
                      </label>
                    </>
                  )
                })()}
                <label className="flex flex-col items-center justify-end gap-0.5 shrink-0 cursor-pointer select-none">
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

          {/* Rows 3+4: crop canvas + placeholder (same width as right panel), then header/zoom/inputs */}
          {activeZoneSources.length > 0 && (
            <CropEditor
              inputIdx={cropSourceIdx ?? activeZoneSources[0]!}
              transforms={draft.transforms ?? {}}
              onChange={(transforms) => { markDirty(); setDraft((prev) => ({ ...prev, transforms })) }}
              lockAspect={activeZoneSources.length >= 2 ? 16 / 9 : (() => { const r = draft.zones[activeZoneIdx]?.rect; return r ? (r.w * pgmResolution.w) / (r.h * pgmResolution.h) : 16 / 9 })()}
              srcW={activeZoneSources.length >= 2 ? 1920 : (production?.inputResolutions?.[cropSourceIdx ?? activeZoneSources[0]!]?.width ?? 1920)}
              srcH={activeZoneSources.length >= 2 ? 1080 : (production?.inputResolutions?.[cropSourceIdx ?? activeZoneSources[0]!]?.height ?? 1080)}
              headerSlot={
                <select
                  value={cropSourceIdx ?? ''}
                  onChange={(e) => setSelectedSourceIdx(e.target.value === '' ? null : parseInt(e.target.value, 10))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] px-1.5 py-0.5 focus:outline-none focus:border-zinc-500"
                >
                  {activeZoneSources.map((srcIdx) => {
                    const slot = inputSlots[srcIdx]
                    if (!slot) return null
                    const res = production?.inputResolutions?.[srcIdx]
                    const label = res ? `${slot.name} (${res.width}×${res.height})` : slot.name
                    return <option key={srcIdx} value={srcIdx}>{label}</option>
                  })}
                </select>
              }
              layout={({ canvas, zoom, controls, header }) => (
                <>
                  {/* Row 3: source selector header */}
                  <div className="border-t border-zinc-700 pt-2">{header}</div>
                  {/* Row 4: crop canvas + same-width placeholder so canvas matches zone canvas width */}
                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0">{canvas}</div>
                    <div className="w-36 shrink-0" />
                  </div>
                  {/* Row 5: zoom slider + x/y/w/h inputs */}
                  <div className="flex flex-col gap-1">
                    {zoom}
                    {controls}
                  </div>
                </>
              )}
            />
          )}
        </div>{/* end zone editor box */}
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

      {/* Source chips — below content in view mode */}
      {!editMode && sourceChips}

    </div>
  )
}
