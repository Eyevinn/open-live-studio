import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { audioApi } from '@/lib/api'
import {
  EQ_BAND_COUNT,
  EQ_BAND_FIELDS,
  EQ_BAND_NAMES,
  SLIDER_STEPS,
  STAGE_FIELDS,
  STAGE_LABELS,
  completeStageParams,
  defaultStageParams,
  formatValue,
  isInRange,
  isStageActive,
  sliderToValue,
  stageHasEnable,
  stageKey,
  stagesForElement,
  valueToSlider,
  type AudioProcParams,
  type AudioProcStage,
  type BandField,
  type ParamRange,
  type ScalarField,
} from '@/lib/audio-processing'
import type { ProcSetCoalescer } from '@/lib/audio-proc-sender'
import { useAudioProcessingStore } from '@/store/audioProcessing.store'

// Channel-strip / main-bus processing view (OL-25b, studio#231). A slide-over
// on the right edge, so the mixer keeps its height. Every change goes out as an
// `AUDIO_PROC_SET` over the controller WebSocket and renders from
// `AUDIO_PROC_STATE`, so all operators stay in sync.

const ACCENT = '#14b8a6'

/** True when any processing stage on the element is active. Primitive result: safe as a Zustand selector. */
export function useElementProcessingActive(elementId: string): boolean {
  return useAudioProcessingStore((s) => {
    const known = s.known[elementId]
    if (!known) return false
    return stagesForElement(elementId).some((stage) => isStageActive(stage, completeStageParams(stage, known[stage])))
  })
}

// ── One labelled control: slider + numeric entry ──────────────────────────────

function ParamControl({ id, range, label, value, rejected, onChange }: {
  id: string
  range: ParamRange
  label: string
  value: number
  rejected: boolean
  onChange: (v: number) => void
}) {
  // Local slider value while dragging, so the slider does not snap back to a
  // lagging server echo (same pattern as LooksPanel's Slider, studio#181/#184).
  const [local, setLocal] = useState(value)
  const draggingRef = useRef(false)
  // Latest store value, read when a drag ends: if `value` changed mid-drag (e.g.
  // a NACK reverted an earlier frame of the same drag) the effect below skipped
  // it, and nothing else would bring the slider back in line with the store.
  const valueRef = useRef(value)
  valueRef.current = value
  useEffect(() => { if (!draggingRef.current) setLocal(value) }, [value])
  const endDrag = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setLocal(valueRef.current)
  }

  const [draft, setDraft] = useState<string | null>(null)
  const draftNum = draft === null ? null : Number(draft)
  const draftInvalid = draft !== null && (draft.trim() === '' || draftNum === null || !isInRange(draftNum, range))

  const commitDraft = () => {
    if (draft === null) return
    if (draftInvalid || draftNum === null) return // out of range: never sent; stays red until fixed or Esc
    setDraft(null)
    setLocal(draftNum)
    onChange(draftNum)
  }

  return (
    <div className="py-0.5">
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-num`} className="text-[10px] text-zinc-400 w-16 shrink-0">{label}</label>
        <input
          type="range"
          min={0} max={SLIDER_STEPS} step={1}
          value={valueToSlider(local, range)}
          aria-label={`${label} slider`}
          onPointerDown={() => { draggingRef.current = true }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onBlur={endDrag}
          onChange={(e) => {
            const v = sliderToValue(Number(e.target.value), range)
            setLocal(v)
            setDraft(null)
            onChange(v)
          }}
          className={cn('flex-1 h-1 cursor-pointer', rejected ? 'accent-red-500' : 'accent-teal-500')}
        />
        <input
          id={`${id}-num`}
          type="text"
          inputMode="decimal"
          value={draft ?? formatValue(local, range)}
          aria-invalid={draftInvalid || rejected}
          title={draftInvalid ? `Must be ${range.min} to ${range.max} ${range.unit}` : `${range.min} to ${range.max} ${range.unit}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (!draftInvalid) commitDraft() }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft()
            else if (e.key === 'Escape') { e.stopPropagation(); setDraft(null) }
          }}
          className={cn(
            'w-14 bg-zinc-900 border rounded px-1 py-0.5 text-[10px] font-mono text-right tabular-nums text-zinc-200',
            draftInvalid || rejected ? 'border-red-500' : 'border-zinc-700',
          )}
        />
        <span className="text-[9px] text-zinc-500 w-6 shrink-0">{range.unit}</span>
      </div>
      {draftInvalid && (
        <p role="alert" className="text-[9px] text-red-400 pl-[4.5rem]">
          {`Must be ${range.min} to ${range.max} ${range.unit} — not sent`}
        </p>
      )}
    </div>
  )
}

// ── One stage ─────────────────────────────────────────────────────────────────

function StageSection({ elementId, stage, onChange }: {
  elementId: string
  stage: AudioProcStage
  onChange: (stage: AudioProcStage, params: AudioProcParams) => void
}) {
  const known = useAudioProcessingStore((s) => s.known[elementId]?.[stage])
  const error = useAudioProcessingStore((s) => s.errors[stageKey(elementId, stage)])
  const params = useMemo(() => completeStageParams(stage, known), [stage, known])
  const active = isStageActive(stage, params)
  const [hpfToggled, setHpfToggled] = useState(false)
  const rejected = (field: string) => error?.fields.includes(field) ?? false
  const idBase = `proc-${elementId}-${stage}`

  const fields = Object.entries(STAGE_FIELDS[stage]) as Array<[ScalarField, ParamRange]>

  return (
    <section className="border-b border-zinc-800 px-3 py-2" aria-label={STAGE_LABELS[stage]}>
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: active ? ACCENT : '#3f3f46' }} />
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-200 flex-1">{STAGE_LABELS[stage]}</h3>
        {stageHasEnable(stage) && (
          <button
            type="button"
            aria-pressed={params.enabled === true}
            onClick={() => {
              if (stage === 'hpf') setHpfToggled(true)
              onChange(stage, { enabled: !params.enabled })
            }}
            className={cn(
              'px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest rounded border-0 cursor-pointer',
              params.enabled ? 'text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300',
              rejected('enabled') && 'ring-1 ring-red-500',
            )}
            style={params.enabled ? { background: ACCENT } : undefined}
          >
            {params.enabled ? 'On' : 'Off'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onChange(stage, defaultStageParams(stage))}
          title={`Reset ${STAGE_LABELS[stage]} to defaults`}
          className="px-2 py-0.5 text-[9px] uppercase tracking-widest rounded border border-zinc-700 bg-transparent text-zinc-400 hover:text-zinc-200 cursor-pointer"
        >
          Reset
        </button>
      </div>

      {stage === 'hpf' && (
        <p className={cn('text-[9px] mb-1', hpfToggled ? 'text-amber-400' : 'text-zinc-500')}>
          High-pass on/off applies on the next activation. The cutoff is live.
        </p>
      )}
      {stage === 'limiter' && (
        <p className="text-[9px] mb-1 text-amber-400/80">
          The limiter currently acts before the master fader (Eyevinn/strom#1023), so raising the master can still clip.
        </p>
      )}
      {error && (
        <p role="alert" className="text-[9px] mb-1 text-red-400">{error.message}</p>
      )}

      {fields.map(([field, range]) => (
        <ParamControl
          key={field}
          id={`${idBase}-${field}`}
          range={range}
          label={range.label}
          value={params[field] ?? 0}
          rejected={rejected(field)}
          onChange={(v) => onChange(stage, { [field]: v })}
        />
      ))}

      {stage === 'eq' && Array.from({ length: EQ_BAND_COUNT }, (_, i) => i + 1).map((band) => {
        const b = params.bands?.find((x) => x.band === band)
        return (
          <div key={band} className="mt-1">
            <div className="text-[9px] uppercase tracking-wider text-zinc-500">Band {band} · {EQ_BAND_NAMES[band - 1]}</div>
            {(Object.entries(EQ_BAND_FIELDS) as Array<[BandField, ParamRange]>).map(([field, range]) => (
              <ParamControl
                key={field}
                id={`${idBase}-b${band}-${field}`}
                range={range}
                label={`${range.label}`}
                value={b?.[field] ?? range.min}
                rejected={rejected(`bands.${band}.${field}`)}
                onChange={(v) => onChange(stage, { bands: [{ band, [field]: v }] })}
              />
            ))}
          </div>
        )
      })}
    </section>
  )
}

// ── Slide-over ────────────────────────────────────────────────────────────────

export function ProcessingPanel({ elementId, label, coalescer, onClose }: {
  elementId: string
  label: string
  coalescer: ProcSetCoalescer
  onClose: () => void
}) {
  const productionId = useAudioProcessingStore((s) => s.productionId)

  // Seed from REST on open, so the view is current even if this client missed
  // a broadcast. Stages with a command in flight are left alone (see `hydrate`).
  useEffect(() => {
    if (!productionId) return
    let stale = false
    audioApi.getProcessing(productionId, elementId)
      .then((res) => {
        if (!stale && res?.processing) useAudioProcessingStore.getState().hydrate(productionId, elementId, res.processing)
      })
      .catch(() => { /* WS replay remains the source of truth */ })
    return () => { stale = true }
  }, [productionId, elementId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleChange = useCallback((stage: AudioProcStage, params: AudioProcParams) => {
    const store = useAudioProcessingStore.getState()
    const error = coalescer.queue(elementId, stage, params)
    if (error) {
      store.setError(elementId, stage, { message: error, fields: Object.keys(params) })
      return
    }
    store.localEdit(elementId, stage, params)
  }, [coalescer, elementId])

  return (
    <div
      role="dialog"
      aria-label={`Processing — ${label}`}
      className="fixed top-0 right-0 h-full z-50 flex flex-col border-l border-zinc-700 shadow-[0_0_24px_rgba(0,0,0,0.6)]"
      style={{ width: 380, maxWidth: '100vw', background: '#111111' }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-100">Processing · {label}</h2>
        <button
          type="button"
          aria-label="Close processing"
          onClick={onClose}
          className="px-2 py-1 text-sm leading-none bg-transparent border-0 text-zinc-400 hover:text-white cursor-pointer"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {stagesForElement(elementId).map((stage) => (
          <StageSection key={stage} elementId={elementId} stage={stage} onChange={handleChange} />
        ))}
      </div>
    </div>
  )
}
