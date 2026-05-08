import { useState, useEffect } from 'react'
import { getProgramMode } from '@/store/programClock.store'
import { Link, useNavigate } from 'react-router'
import { useProductionsStore, type Production } from '@/store/productions.store'
import { useProductionStore } from '@/store/production.store'
import { useSourcesStore } from '@/store/sources.store'
import { useTemplatesStore } from '@/store/templates.store'
import { useGraphicsStore } from '@/store/graphics.store'
import { useOutputsStore } from '@/store/outputs.store'
import { productionsApi, productionConfigsApi } from '@/lib/api'
import type { ApiTemplate, TemplateProperty, ProductionConfig, ProductionGraphicAssignment } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { Modal } from '@/components/ui/Modal'
import { Tooltip } from '@/components/ui/Tooltip'

// ---------------------------------------------------------------------------
// Stream type labels — used for grouping source dropdowns
// ---------------------------------------------------------------------------

const STREAM_TYPE_LABELS = {
  srt: 'MPEG-TS/SRT',
  efp: 'EFP/SRT',
  whip: 'WHIP',
  html: 'HTML',
  test1: 'Pinwheel',
  test2: 'Colors',
} as const

// ---------------------------------------------------------------------------
// Shared select style
// ---------------------------------------------------------------------------

const selectCls =
  'w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent] appearance-none cursor-pointer'

const inputCls =
  'w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent]'

const MAX_INPUTS = 10
const MIN_INPUTS = 2

function mixerInput(index: number) { return `video_in_${index}` }

// ---------------------------------------------------------------------------
// Source slot row — one input
// ---------------------------------------------------------------------------

interface SlotRowProps {
  index: number
  currentSourceId: string
  canRemove: boolean
  onChange: (sourceId: string) => void
  onRemove: () => void
}

function SlotRow({ index: _index, currentSourceId, canRemove, onChange, onRemove }: SlotRowProps) {
  const sources = useSourcesStore((s) => s.sources)
  return (
    <div className="flex items-center gap-2">
      <select value={currentSourceId} onChange={(e) => onChange(e.target.value)} className={`${selectCls} flex-1`}>
        <option value="">— unassigned —</option>
        {Object.entries(
          [...sources].sort((a, b) => a.name.localeCompare(b.name)).reduce<Record<string, typeof sources>>((acc, s) => {
            ;(acc[s.streamType] ??= []).push(s)
            return acc
          }, {}),
        )
          .sort(([a], [b]) => {
            const ORDER = ['srt', 'efp', 'html', 'whip']
            const ai = ORDER.indexOf(a), bi = ORDER.indexOf(b)
            if (ai !== -1 && bi !== -1) return ai - bi
            if (ai !== -1) return -1
            if (bi !== -1) return 1
            return a.localeCompare(b)
          })
          .map(([type, group]) => (
            <optgroup key={type} label={STREAM_TYPE_LABELS[type as keyof typeof STREAM_TYPE_LABELS] ?? type.toUpperCase()}>
              {group.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
        <optgroup label="WebRTC">
          <option value="Whip">WHIP Input</option>
        </optgroup>
        <optgroup label="Virtual Sources">
          <option value="__test1__">Pinwheel</option>
          <option value="__test2__">Colors</option>
        </optgroup>
      </select>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="text-[--color-text-muted] hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed text-sm px-1 transition-colors"
        title="Remove input"
      >
        ✕
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DSK graphic slot row
// ---------------------------------------------------------------------------

const DSK_SLOTS = ['dsk_in_0', 'dsk_in_1'] as const
const DSK_LABELS: Record<string, string> = { dsk_in_0: 'DSK 1', dsk_in_1: 'DSK 2' }

interface GfxSlotRowProps {
  dskInput: string
  currentGraphicId: string
  onChange: (graphicId: string) => void
}

function GfxSlotRow({ dskInput: _dskInput, currentGraphicId, onChange }: GfxSlotRowProps) {
  const graphics = useGraphicsStore((s) => s.graphics)
  return (
    <div className="flex items-center gap-2">
      <select value={currentGraphicId} onChange={(e) => onChange(e.target.value)} className={`${selectCls} flex-1`}>
        <option value="">— none —</option>
        {[...graphics].sort((a, b) => a.name.localeCompare(b.name)).map((g) => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Output slot row
// ---------------------------------------------------------------------------

const VIRTUAL_OUTPUT_ID = '__whep__'

function toCallerUrl(url: string): string {
  return url.replace(/mode=listener/i, 'mode=caller')
}

const OUTPUT_TYPE_LABELS: Record<string, string> = {
  mpegtssrt: 'MPEG-TS/SRT',
  efpsrt: 'EFP/SRT',
}

interface OutputSlotRowProps {
  value: string
  usedIds: string[]
  takenByOtherIds: string[]
  canRemove: boolean
  onChange: (id: string) => void
  onRemove: () => void
}

function OutputSlotRow({ value, usedIds, takenByOtherIds, canRemove, onChange, onRemove }: OutputSlotRowProps) {
  const outputs = useOutputsStore((s) => s.outputs)
  return (
    <div className="flex items-center gap-2">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${selectCls} flex-1`}>
        <option value="">— none —</option>
        {Object.entries(
          [...outputs]
            .filter((o) => o.outputType !== 'whep')
            .filter((o) => o.id === value || !usedIds.includes(o.id))
            .sort((a, b) => a.name.localeCompare(b.name))
            .reduce<Record<string, typeof outputs>>((acc, o) => {
              ;(acc[o.outputType] ??= []).push(o)
              return acc
            }, {}),
        )
          .sort(([a], [b]) => {
            const ORDER = ['mpegtssrt', 'efpsrt']
            const ai = ORDER.indexOf(a), bi = ORDER.indexOf(b)
            if (ai !== -1 && bi !== -1) return ai - bi
            if (ai !== -1) return -1
            if (bi !== -1) return 1
            return a.localeCompare(b)
          })
          .map(([type, group]) => (
            <optgroup key={type} label={OUTPUT_TYPE_LABELS[type] ?? type.toUpperCase()}>
              {group.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </optgroup>
          ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="text-[--color-text-muted] hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed text-sm px-1 transition-colors"
        title="Remove output"
      >
        ✕
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Production options modal — sources, template, endpoints
// ---------------------------------------------------------------------------

interface OptionsModalProps {
  production: Production
  template: ApiTemplate | null
  onClose: () => void
}

function ProductionOptionsModal({ production, template, onClose }: OptionsModalProps) {
  const { assignSource, unassignSource, assignGraphic, unassignGraphic, updateValues, updateName, assignOutput, unassignOutput } = useProductionsStore()
  const allProductions = useProductionsStore((s) => s.productions)
  const sources = useSourcesStore((s) => s.sources)
  const graphics = useGraphicsStore((s) => s.graphics)
  const catalogueOutputs = useOutputsStore((s) => s.outputs)
  const isActive = production.status === 'active'

  // Output IDs already assigned to other productions (so we can hide them from this production's dropdowns)
  const outputsTakenByOthers = allProductions
    .filter((p) => p.id !== production.id)
    .flatMap((p) => p.outputAssignments.map((a) => a.outputId))


  const [outputList, setOutputList] = useState<string[]>(() =>
    (production.outputAssignments ?? []).map((a) => a.outputId),
  )

  // airTime: store as datetime-local string (local time, no seconds) for the input,
  // convert to/from UTC ISO on save/load.
  const [airTimeLocal, setAirTimeLocal] = useState<string>(() => {
    if (!production.airTime) return ''
    const d = new Date(production.airTime)
    // Format as "YYYY-MM-DDTHH:MM" in local time for datetime-local input
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })

  async function handleAirTimeChange(val: string) {
    setAirTimeLocal(val)
    if (!val) {
      await useProductionsStore.getState().updateAirTime(production.id, null)
    } else {
      const d = new Date(val) // datetime-local parses as local time
      if (!isNaN(d.getTime())) {
        await useProductionsStore.getState().updateAirTime(production.id, d.toISOString())
      }
    }
  }

  async function handleOutputChange(index: number, newId: string) {
    const oldId = outputList[index]
    const next = [...outputList]
    next[index] = newId
    setOutputList(next)
    if (oldId && oldId !== newId) await unassignOutput(production.id, oldId)
    if (newId && newId !== oldId) await assignOutput(production.id, newId)
  }

  async function handleOutputRemove(index: number) {
    const id = outputList[index]
    setOutputList((prev) => prev.filter((_, i) => i !== index))
    if (id) await unassignOutput(production.id, id)
  }

  const [prodName, setProdName] = useState(production.name)

  async function handleNameBlur() {
    const trimmed = prodName.trim()
    if (trimmed && trimmed !== production.name) await updateName(production.id, trimmed)
    else setProdName(production.name)
  }

  const [assignments, setAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(production.sources.map((s) => [s.mixerInput, s.sourceId]))
  )
  const [slotCount, setSlotCount] = useState(() =>
    Math.max(MIN_INPUTS, production.sources.length)
  )
  const [gfxAssignments, setGfxAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries((production.graphicAssignments ?? []).map((g) => [g.dskInput, g.graphicId]))
  )

  async function handleChange(index: number, sourceId: string) {
    const pad = mixerInput(index)
    setAssignments((prev) => ({ ...prev, [pad]: sourceId }))
    if (sourceId) {
      await assignSource(production.id, { mixerInput: pad, sourceId })
    } else {
      await unassignSource(production.id, pad)
    }
  }

  async function handleRemove(index: number) {
    if (slotCount <= MIN_INPUTS) return

    // Shift all assignments after the removed index down by 1, clear the last slot
    const newAssignments = { ...assignments }
    for (let i = index; i < slotCount - 1; i++) {
      const next = mixerInput(i + 1)
      const curr = mixerInput(i)
      if (newAssignments[next]) { newAssignments[curr] = newAssignments[next] }
      else { delete newAssignments[curr] }
    }
    delete newAssignments[mixerInput(slotCount - 1)]

    setAssignments(newAssignments)
    setSlotCount((c) => c - 1)

    // Sync backend for every slot that changed
    const ops: Promise<unknown>[] = []
    for (let i = index; i < slotCount; i++) {
      const pad = mixerInput(i)
      const newSrc = newAssignments[pad]
      const oldSrc = assignments[pad]
      if (newSrc && newSrc !== oldSrc) ops.push(assignSource(production.id, { mixerInput: pad, sourceId: newSrc }))
      else if (!newSrc && oldSrc) ops.push(unassignSource(production.id, pad))
    }
    await Promise.all(ops)
  }

  async function handleGfxChange(dskInput: string, graphicId: string) {
    setGfxAssignments((prev) => ({ ...prev, [dskInput]: graphicId }))
    if (graphicId) {
      await assignGraphic(production.id, { dskInput, graphicId })
    } else {
      await unassignGraphic(production.id, dskInput)
    }
  }

  const [configValues, setConfigValues] = useState<Record<string, string | number>>(() => {
    if (production.values && Object.keys(production.values).length > 0) return { ...production.values }
    return Object.fromEntries((template?.properties ?? []).map((p) => [p.id, p.default]))
  })
  const [valuesDirty, setValuesDirty] = useState(false)

  function handleValueChange(id: string, value: string | number) {
    setConfigValues((prev) => ({ ...prev, [id]: value }))
    setValuesDirty(true)
  }

  const assigned = Object.values(assignments).filter(Boolean).length

  return (
    <Modal open title="Production Options" onClose={onClose} className="max-w-3xl">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-x-8">

          {/* LEFT — name + config */}
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-orange-500">Name</span>
              <input
                className={inputCls}
                value={prodName}
                onChange={(e) => setProdName(e.target.value)}
                onBlur={() => void handleNameBlur()}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              />
            </div>

            {template && (template.properties?.length ?? 0) > 0 && (
              <div className="flex flex-col gap-3">
                <span className="text-xs uppercase tracking-wider text-orange-500">Configuration</span>
                {isActive ? (
                  <div className="flex flex-col gap-2">
                    {(template.properties ?? []).map((prop) => (
                      <div key={prop.id} className="flex flex-col gap-0.5">
                        <span className="text-xs text-[--color-text-muted]">{prop.label}</span>
                        <span className="text-sm text-[--color-text-primary] font-mono">
                          {prop.type === 'select'
                            ? (prop.options?.find((o) => o.value === String(configValues[prop.id] ?? prop.default))?.label ?? String(configValues[prop.id] ?? prop.default))
                            : `${configValues[prop.id] ?? prop.default}${prop.unit ? ` ${prop.unit}` : ''}`}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {(template.properties ?? []).map((prop) => (
                      <div key={prop.id}>
                        <label className="text-xs text-[--color-text-muted] block mb-1">{prop.label}</label>
                        <PropertyField
                          property={prop}
                          value={configValues[prop.id] ?? prop.default}
                          onChange={(v) => handleValueChange(prop.id, v)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT — sources, graphics, outputs */}
          <div className="flex flex-col gap-5 border-l border-[--color-border] pl-8">

            {/* Sources */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-orange-500">Sources</span>
                <span className="text-xs font-mono text-[--color-text-muted]">{assigned} assigned</span>
              </div>
              {isActive ? (
                <div className="flex flex-col gap-1.5">
                  {production.sources.length === 0 ? (
                    <span className="text-xs text-[--color-text-muted] italic">No sources assigned</span>
                  ) : (
                    production.sources.map((s) => (
                      <SourceAssignmentBadge key={s.mixerInput} assignment={s} />
                    ))
                  )}
                </div>
              ) : sources.length === 0 ? (
                <p className="text-xs text-[--color-text-muted] py-1">No sources available.</p>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: slotCount }, (_, i) => (
                      <SlotRow
                        key={i}
                        index={i}
                        currentSourceId={assignments[mixerInput(i)] ?? ''}
                        canRemove={slotCount > MIN_INPUTS}
                        onChange={(sourceId) => void handleChange(i, sourceId)}
                        onRemove={() => void handleRemove(i)}
                      />
                    ))}
                  </div>
                  {slotCount < MAX_INPUTS && (
                    <button
                      type="button"
                      onClick={() => setSlotCount((c) => c + 1)}
                      className="text-xs text-[--color-accent] hover:opacity-80 text-left transition-opacity"
                    >
                      + New Input
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Graphics (DSK) */}
            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-wider text-orange-500">Graphics (DSK)</span>
              {isActive ? (
                <div className="flex flex-col gap-1.5">
                  {DSK_SLOTS.map((dskInput) => {
                    const graphicId = gfxAssignments[dskInput]
                    const graphic = graphics.find((g) => g.id === graphicId)
                    return (
                      <div key={dskInput} className="flex items-center gap-2">
                        {graphic
                          ? <span className="text-xs text-[--color-text-primary]">{graphic.name}</span>
                          : <span className="text-xs text-[--color-text-muted] italic">None</span>
                        }
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {DSK_SLOTS.map((dskInput) => (
                    <GfxSlotRow
                      key={dskInput}
                      dskInput={dskInput}
                      currentGraphicId={gfxAssignments[dskInput] ?? ''}
                      onChange={(graphicId) => void handleGfxChange(dskInput, graphicId)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Outputs */}
            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-wider text-orange-500">Outputs</span>
              {isActive ? (
                <div className="flex flex-col gap-1.5">
                  {outputList.length === 0
                    ? <span className="text-xs text-[--color-text-muted] italic">No outputs assigned</span>
                    : outputList.map((outputId) => {
                        const label = outputId === VIRTUAL_OUTPUT_ID ? 'WHEP Output' : (catalogueOutputs.find((o) => o.id === outputId)?.name ?? outputId)
                        return (
                          <div key={outputId} className="flex items-center gap-2">
                            <span className="text-xs text-[--color-text-primary]">{label}</span>
                          </div>
                        )
                      })
                  }
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {outputList.map((id, i) => (
                    <OutputSlotRow
                      key={i}
                      value={id}
                      usedIds={outputList}
                      takenByOtherIds={[]}
                      canRemove={true}
                      onChange={(newId) => void handleOutputChange(i, newId)}
                      onRemove={() => void handleOutputRemove(i)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setOutputList((prev) => [...prev, ''])}
                    className="text-xs text-[--color-accent] hover:opacity-80 text-left transition-opacity"
                  >
                    + New Output
                  </button>
                </div>
              )}
            </div>

            {/* Air Time */}
            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-wider text-orange-500">Air Time <span className="normal-case text-[--color-text-muted]">(optional)</span></span>
              {isActive ? (
                <span className="text-sm text-[--color-text-primary] font-mono">
                  {production.airTime
                    ? new Date(production.airTime).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                    : <span className="text-[--color-text-muted] italic text-xs">Not set</span>}
                </span>
              ) : (
                <input
                  type="datetime-local"
                  value={airTimeLocal}
                  onChange={(e) => void handleAirTimeChange(e.target.value)}
                  className={selectCls}
                />
              )}
            </div>

          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-[--color-border]">
          {isActive && (
            <span className="text-xs text-[--color-text-muted] italic">Deactivate this production to make changes.</span>
          )}
          <Button variant="active" onClick={() => { if (valuesDirty) void updateValues(production.id, configValues); onClose() }} className="ml-auto">Done</Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// New production modal — name + template + initial source assignments
// ---------------------------------------------------------------------------

interface CreateModalProps {
  onClose: () => void
  onCreated: () => void
}

function PropertyField({
  property,
  value,
  onChange,
}: {
  property: TemplateProperty
  value: string | number
  onChange: (v: string | number) => void
}) {
  if (property.type === 'select') {
    return (
      <select
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className={selectCls}
      >
        {property.options?.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  }
  if (property.type === 'number') {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={property.min}
          max={property.max}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className={inputCls}
        />
        {property.unit && (
          <span className="text-[--color-text-muted] text-xs shrink-0">{property.unit}</span>
        )}
      </div>
    )
  }
  return (
    <input
      type="text"
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
    />
  )
}

function defaultConfigValues(properties: TemplateProperty[]): Record<string, string | number> {
  return Object.fromEntries(properties.map((p) => [p.id, p.default]))
}

function CreateProductionModal({ onClose, onCreated }: CreateModalProps) {
  const { fetchAll } = useProductionsStore()
  const allProductions = useProductionsStore((s) => s.productions)
  const templates = useTemplatesStore((s) => s.templates)
  const sources = useSourcesStore((s) => s.sources)

  // All outputs already assigned to any existing production
  const outputsTakenByAll = allProductions.flatMap((p) => p.outputAssignments.map((a) => a.outputId))

  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState(() => templates[0]?.id ?? '')
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [gfxAssignments, setGfxAssignments] = useState<Record<string, string>>({})
  const [outputList, setOutputList] = useState<string[]>([])
  const [airTimeLocal, setAirTimeLocal] = useState('')
  const [slotCount, setSlotCount] = useState(MIN_INPUTS)
  const [saving, setSaving] = useState(false)

  const [configValues, setConfigValues] = useState<Record<string, string | number>>({})
  const [savedConfigs, setSavedConfigs] = useState<ProductionConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState<string>('')
  const [saveAsConfig, setSaveAsConfig] = useState(false)
  const [configName, setConfigName] = useState('')

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null
  const hasProperties = (selectedTemplate?.properties?.length ?? 0) > 0

  // Auto-select first template if none selected yet (e.g. templates loaded after mount)
  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id)
  }, [templates, templateId])

  // Reset state when template changes
  useEffect(() => {
    setAssignments({})
    setSlotCount(MIN_INPUTS)
    setSelectedConfigId('')
    setSaveAsConfig(false)
    setConfigName('')
    if (selectedTemplate?.properties) {
      setConfigValues(defaultConfigValues(selectedTemplate.properties))
      void productionConfigsApi.list(templateId).then(setSavedConfigs).catch(() => {
        setSavedConfigs([])
      })
    } else {
      setConfigValues({})
      setSavedConfigs([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId])

  function handleConfigSelect(cfgId: string) {
    setSelectedConfigId(cfgId)
    if (!cfgId) return
    const cfg = savedConfigs.find((c) => c._id === cfgId)
    if (cfg) setConfigValues({ ...cfg.values })
  }

  function handlePropertyChange(id: string, value: string | number) {
    setConfigValues((prev) => ({ ...prev, [id]: value }))
    setSelectedConfigId('') // deselect saved config when user edits manually
  }

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)
    try {
      if (saveAsConfig && configName.trim() && templateId && hasProperties) {
        await productionConfigsApi.create({
          name: configName.trim(),
          templateId,
          values: configValues,
        })
      }

      const prod = await productionsApi.create({ name: name.trim() })
      const airTimeIso = airTimeLocal ? new Date(airTimeLocal).toISOString() : undefined
      const updateBody: { templateId?: string; values?: Record<string, string | number>; airTime?: string } = {}
      if (templateId) updateBody.templateId = templateId
      if (hasProperties && Object.keys(configValues).length > 0) updateBody.values = configValues
      if (airTimeIso) updateBody.airTime = airTimeIso
      if (Object.keys(updateBody).length > 0) await productionsApi.update(prod.id, updateBody)
      for (const [pad, sourceId] of Object.entries(assignments)) {
        if (sourceId) await productionsApi.assignSource(prod.id, { mixerInput: pad, sourceId })
      }
      for (const [dskInput, graphicId] of Object.entries(gfxAssignments)) {
        if (graphicId) await productionsApi.assignGraphic(prod.id, { dskInput, graphicId } as ProductionGraphicAssignment)
      }
      for (const outputId of outputList) {
        if (outputId) await productionsApi.assignOutput(prod.id, outputId)
      }
      await fetchAll()
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  const assignedCount = Object.values(assignments).filter(Boolean).length

  return (
    <Modal open title="New Production" onClose={onClose} className="max-w-3xl">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-x-8">

          {/* LEFT — name, template, config */}
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">
                Production Name
              </label>
              <input
                type="text"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !saving) void handleCreate() }}
                placeholder="Evening News — May 1"
                className={inputCls}
              />
            </div>

            {selectedTemplate && hasProperties && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wider text-orange-500 shrink-0">Configuration</span>
                  <select
                    value={selectedConfigId}
                    onChange={(e) => handleConfigSelect(e.target.value)}
                    className="flex-1 px-2 py-1 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-xs text-[--color-text-primary] focus:outline-none focus:border-orange-500 appearance-none cursor-pointer"
                  >
                    <option value="">— load saved config —</option>
                    {savedConfigs.map((c) => (
                      <option key={c._id} value={c._id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {(selectedTemplate.properties ?? []).map((prop) => (
                  <div key={prop.id}>
                    <label className="text-xs text-[--color-text-muted] block mb-1">{prop.label}</label>
                    <PropertyField
                      property={prop}
                      value={configValues[prop.id] ?? prop.default}
                      onChange={(v) => handlePropertyChange(prop.id, v)}
                    />
                  </div>
                ))}

                <label className="flex items-center justify-end gap-2 cursor-pointer select-none">
                  <span className="text-xs text-[--color-text-muted]">Save as config</span>
                  <input
                    type="checkbox"
                    checked={saveAsConfig}
                    onChange={(e) => setSaveAsConfig(e.target.checked)}
                    className="accent-orange-500"
                  />
                </label>
                {saveAsConfig && (
                  <input
                    type="text"
                    value={configName}
                    onChange={(e) => setConfigName(e.target.value)}
                    placeholder="Config name, e.g. HD Standard"
                    className={inputCls}
                  />
                )}
              </div>
            )}
          </div>

          {/* RIGHT — sources, graphics, outputs */}
          <div className="flex flex-col gap-4 border-l border-[--color-border] pl-8">

            {/* Sources */}
            {selectedTemplate && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-orange-500">Sources</span>
                  <span className="text-xs font-mono text-[--color-text-muted]">{assignedCount} assigned</span>
                </div>
                {sources.length === 0 ? (
                  <p className="text-xs text-[--color-text-muted] py-1">No sources available.</p>
                ) : (
                  <>
                    <div className="flex flex-col gap-2">
                      {Array.from({ length: slotCount }, (_, i) => (
                        <SlotRow
                          key={i}
                          index={i}
                          currentSourceId={assignments[mixerInput(i)] ?? ''}
                          canRemove={slotCount > MIN_INPUTS}
                          onChange={(sourceId) =>
                            setAssignments((prev) => ({ ...prev, [mixerInput(i)]: sourceId }))
                          }
                          onRemove={() => {
                            setAssignments((prev) => {
                              const n = { ...prev }
                              for (let j = i; j < slotCount - 1; j++) {
                                const next = mixerInput(j + 1)
                                const curr = mixerInput(j)
                                if (n[next]) { n[curr] = n[next] } else { delete n[curr] }
                              }
                              delete n[mixerInput(slotCount - 1)]
                              return n
                            })
                            setSlotCount((c) => c - 1)
                          }}
                        />
                      ))}
                    </div>
                    {slotCount < MAX_INPUTS && (
                      <button
                        type="button"
                        onClick={() => setSlotCount((c) => c + 1)}
                        className="text-xs text-[--color-accent] hover:opacity-80 text-left transition-opacity"
                      >
                        + New Input
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Graphics (DSK) */}
            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-wider text-orange-500">Graphics (DSK)</span>
              <div className="flex flex-col gap-2">
                {DSK_SLOTS.map((dskInput) => (
                  <GfxSlotRow
                    key={dskInput}
                    dskInput={dskInput}
                    currentGraphicId={gfxAssignments[dskInput] ?? ''}
                    onChange={(graphicId) =>
                      setGfxAssignments((prev) => ({ ...prev, [dskInput]: graphicId }))
                    }
                  />
                ))}
              </div>
            </div>

            {/* Outputs */}
            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-wider text-orange-500">Outputs</span>
              <div className="flex flex-col gap-2">
                {outputList.map((id, i) => (
                  <OutputSlotRow
                    key={i}
                    value={id}
                    usedIds={outputList}
                    takenByOtherIds={[]}
                    canRemove={true}
                    onChange={(newId) => setOutputList((prev) => prev.map((v, j) => j === i ? newId : v))}
                    onRemove={() => setOutputList((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setOutputList((prev) => [...prev, ''])}
                  className="text-xs text-[--color-accent] hover:opacity-80 text-left transition-opacity"
                >
                  + New Output
                </button>
              </div>
            </div>

            {/* Air Time */}
            <div className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-wider text-orange-500">Air Time <span className="normal-case text-[--color-text-muted]">(optional)</span></span>
              <input
                type="datetime-local"
                value={airTimeLocal}
                onChange={(e) => setAirTimeLocal(e.target.value)}
                className={selectCls}
              />
            </div>

          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-[--color-border]">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="active"
            onClick={() => void handleCreate()}
            disabled={!name.trim() || (saveAsConfig && !configName.trim()) || saving}
          >
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Productions panel
// ---------------------------------------------------------------------------

export function ProductionsPanel() {
  const { productions, isLoading, removeProduction, updateStatus, fetchAll } = useProductionsStore()
  const { activeProductionId, setActiveProduction } = useProductionStore()
  const templates = useTemplatesStore((s) => s.templates)
  const outputs = useOutputsStore((s) => s.outputs)
  const navigate = useNavigate()

  const fetchSources = useSourcesStore((s) => s.fetchAll)
  const fetchGraphics = useGraphicsStore((s) => s.fetchAll)
  const fetchOutputs = useOutputsStore((s) => s.fetchAll)

  // Poll productions every 15s; pre-load supporting resources once for modals
  useEffect(() => {
    void fetchAll()
    void fetchSources()
    void fetchGraphics()
    void fetchOutputs()
    const id = setInterval(() => void fetchAll(), 15000)
    return () => clearInterval(id)
  }, [fetchAll, fetchSources, fetchGraphics, fetchOutputs])

  // Ticks every second so on-air pills update in real time
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const [addOpen, setAddOpen] = useState(false)
  const [optionsId, setOptionsId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deactivateTargetId, setDeactivateTargetId] = useState<string | null>(null)
  const [activationError, setActivationError] = useState<{ prodId: string; message: string } | null>(null)

  async function handleDelete(id: string) {
    await removeProduction(id)
    if (activeProductionId === id) setActiveProduction(null)
    setDeleteTargetId(null)
  }

  const optionsProd = optionsId ? productions.find((p) => p.id === optionsId) : null
  const optionsTemplate = optionsProd?.templateId ? templates.find((t) => t.id === optionsProd.templateId) ?? null : null
  const deleteTarget = deleteTargetId ? productions.find((p) => p.id === deleteTargetId) : null
  const deactivateTarget = deactivateTargetId ? productions.find((p) => p.id === deactivateTargetId) : null

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[--color-text-muted] font-mono">
            {productions.length} productions
          </span>
          {isLoading && <span className="text-xs text-[--color-accent]">Refreshing…</span>}
        </div>
        <Button size="sm" variant="active" onClick={() => setAddOpen(true)}>+ New Production</Button>
      </div>

      {/* Production list */}
      <div className="flex flex-col gap-2">
        {[...productions].sort((a, b) => a.name.localeCompare(b.name)).map((prod) => {
          const isActive = prod.status === 'active'
          const isActivating = prod.status === 'activating'
          const template = templates.find((t) => t.id === prod.templateId)
          const assignedCount = prod.sources.length
          const airStartMs = prod.airTime ? new Date(prod.airTime).getTime() : null
          const isOnAir = getProgramMode(airStartMs, now) === 'onair'

          return (
            <div
              key={prod.id}
              className={`flex items-center gap-3 px-4 py-3 rounded border transition-colors ${
                isActivating
                  ? 'bg-[--color-surface-3] border-[--color-border] cursor-not-allowed'
                  : isActive
                  ? 'bg-[--color-surface-3] border-[--color-accent] hover:border-orange-400 cursor-pointer'
                  : 'bg-[--color-surface-3] border-[--color-border] hover:border-orange-500 cursor-pointer'
              }`}
              onClick={() => {
                if (isActivating) return
                if (isActive) void navigate(`/studio?production=${prod.id}`)
                else setOptionsId(prod.id)
              }}
            >
              <StatusDot
                color={isActive ? 'red' : isActivating ? 'yellow' : 'gray'}
                pulse={isActivating}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[--color-text-primary] truncate">
                    {prod.name}
                  </span>
                  {isActive && isOnAir && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-red-600 text-white">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse inline-block" />
                      On Air
                    </span>
                  )}
                  {prod.deletionWarnings && prod.deletionWarnings.length > 0 && (() => {
                    const byType = prod.deletionWarnings!.reduce<Record<string, string[]>>((acc, w) => {
                      ;(acc[w.type] ??= []).push(w.name)
                      return acc
                    }, {})
                    return (
                      <Tooltip
                        className="shrink-0 text-yellow-400 cursor-default"
                        content={
                          <div className="bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-xs text-left shadow-lg w-56">
                            <p className="font-semibold text-white mb-1.5">The following have been deleted:</p>
                            {byType['source'] && byType['source'].map((n, i) => (
                              <p key={i} className="text-zinc-200">
                                {i === 0 && <span className="text-zinc-400 uppercase tracking-wider text-[10px]">Sources: </span>}
                                {i > 0 && <span className="text-zinc-400 uppercase tracking-wider text-[10px] invisible">Sources: </span>}
                                {n}
                              </p>
                            ))}
                            {byType['output'] && byType['output'].map((n, i) => (
                              <p key={i} className="text-zinc-200">
                                {i === 0 && <span className="text-zinc-400 uppercase tracking-wider text-[10px]">Outputs: </span>}
                                {i > 0 && <span className="text-zinc-400 uppercase tracking-wider text-[10px] invisible">Outputs: </span>}
                                {n}
                              </p>
                            ))}
                            {byType['graphic'] && byType['graphic'].map((n, i) => (
                              <p key={i} className="text-zinc-200">
                                {i === 0 && <span className="text-zinc-400 uppercase tracking-wider text-[10px]">Graphics: </span>}
                                {i > 0 && <span className="text-zinc-400 uppercase tracking-wider text-[10px] invisible">Graphics: </span>}
                                {n}
                              </p>
                            ))}
                          </div>
                        }
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-label="Deletion warning">
                          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                        </svg>
                      </Tooltip>
                    )
                  })()}
                </div>
                <div className="flex items-center gap-2 mt-0.5 min-w-0">
                  <span className="text-xs text-[--color-text-muted] truncate">
                    {template ? template.name : 'No template'}{assignedCount > 0 ? ` · ${assignedCount} ${assignedCount === 1 ? 'source' : 'sources'}` : ''}
                  </span>
                  {isActive && prod.whipEndpoints?.map((ep) => {
                    const idx = /(\d+)$/.exec(ep.mixerInput)?.[1]
                    return (
                      <InlineCopyButton
                        key={ep.mixerInput}
                        label={`WHIP IN: Input ${idx !== undefined ? parseInt(idx, 10) + 1 : ep.mixerInput}`}
                        value={ep.url}
                      />
                    )
                  })}
                  {isActive && prod.pgmWhepEndpoint && (
                    <InlineCopyButton label="WHEP OUT: PGM" value={prod.pgmWhepEndpoint} />
                  )}
                  {isActive && prod.srtOutputUri && (
                    <InlineCopyButton label="SRT OUT: Program" value={toCallerUrl(prod.srtOutputUri)} displayUrl={prod.srtOutputUri} />
                  )}
                  {isActive && prod.outputAssignments?.flatMap((a) => {
                    const out = outputs.find((o) => o.id === a.outputId)
                    if (!out || out.outputType === 'whep' || !out.url) return []
                    return [<InlineCopyButton key={a.outputId} label={`SRT OUT: ${out.name}`} value={toCallerUrl(out.url)} displayUrl={out.url} />]
                  })}
                  {isActive && prod.whepOutputUrls?.map((w) => {
                    const out = outputs.find((o) => o.id === w.outputId)
                    return <InlineCopyButton key={w.outputId} label={`WHEP OUT: ${out?.name ?? 'Output'}`} value={w.url} />
                  })}
                </div>
                {activationError?.prodId === prod.id && (
                  <p className="text-xs text-red-400 mt-0.5">{activationError.message}</p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {isActive && (
                  <Link
                    to={`/studio?production=${prod.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-[--color-accent]/10 text-[--color-accent] border border-[--color-accent]/30 hover:bg-[--color-accent]/20 transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 2 24 24" fill="none" aria-hidden="true">
                      <rect x="3" y="8" width="18" height="13" rx="1.5" stroke="var(--color-accent)" strokeWidth="1.5" />
                      <path d="M3 12h18" stroke="var(--color-accent)" strokeWidth="1.5" />
                      <path d="M7 8L5 12" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M11 8L9 12" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M15 8l-2 4" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M19 8l-2 4" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    Studio
                  </Link>
                )}
                {isActive ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isActivating}
                    onClick={(e) => { e.stopPropagation(); setDeactivateTargetId(prod.id) }}
                    className="text-orange-500 hover:text-orange-400 border-transparent"
                  >
                    Deactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isActivating}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!isActivating) {
                        setActivationError(null)
                        updateStatus(prod.id, 'active')
                          .then(() => setActiveProduction(prod.id))
                          .catch((err: unknown) => setActivationError({ prodId: prod.id, message: err instanceof Error ? err.message : 'Activation failed' }))
                      }
                    }}
                    className="text-orange-500 hover:text-orange-400 border-transparent"
                  >
                    {isActivating ? 'Activating...' : 'Activate'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); setOptionsId(prod.id) }}
                  disabled={isActivating}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
                    <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                    <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                  Options
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); setDeleteTargetId(prod.id) }}
                  disabled={isActive || isActivating}
                  className="text-white hover:text-red-400"
                  title={isActive ? 'Deactivate production before deleting' : undefined}
                >
                  Delete
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Deactivate confirmation modal */}
      {deactivateTarget && (
        <Modal open title="Deactivate Production" onClose={() => setDeactivateTargetId(null)} className="max-w-sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[--color-text-primary]">
              Deactivate <span className="font-semibold">{deactivateTarget.name}</span>? This will stop the live production.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeactivateTargetId(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  void updateStatus(deactivateTarget.id, 'inactive')
                  setActiveProduction(null)
                  setDeactivateTargetId(null)
                }}
              >
                Deactivate
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <Modal open title="Delete Production" onClose={() => setDeleteTargetId(null)} className="max-w-sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[--color-text-primary]">
              Delete <span className="font-semibold">{deleteTarget.name}</span>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteTargetId(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void handleDelete(deleteTarget.id)}>Delete</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create modal */}
      {addOpen && (
        <CreateProductionModal
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); void fetchAll() }}
        />
      )}

      {/* Options modal */}
      {optionsProd && (
        <ProductionOptionsModal
          production={optionsProd}
          template={optionsTemplate}
          onClose={() => setOptionsId(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small badge showing mixerInput → source name
// ---------------------------------------------------------------------------

const VIRTUAL_SOURCE_NAMES: Record<string, string> = {
  'Whip': 'WHIP',
  '__test1__': 'Pinwheel',
  '__test2__': 'Colors',
}

function InlineCopyButton({ label, value, displayUrl }: { label: string; value: string; displayUrl?: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={displayUrl ?? value}
      className="relative -top-0.5 inline-flex items-center gap-1 shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] border border-[--color-border] text-[--color-text-muted] hover:text-orange-500 hover:border-[--color-accent]/40 transition-colors cursor-pointer"
    >
      {copied ? (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 12l6 6L20 6" stroke="var(--color-pvw)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      <span className="uppercase tracking-wide">{label}</span>
    </button>
  )
}

function EndpointRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted] uppercase shrink-0">
        {label}
      </span>
      <span className="text-xs font-mono text-[--color-text-primary] truncate flex-1">{url}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="text-xs text-[--color-text-muted] hover:text-orange-500 transition-colors shrink-0"
        title={`Copy ${label} URI`}
      >
        {copied ? '✓' : '⎘'}
      </button>
    </div>
  )
}

function WhipEndpointRow({ mixerInput, url }: { mixerInput: string; url: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] text-[--color-text-muted] uppercase shrink-0">
        WHIP
      </span>
      <span className="text-xs font-mono text-[--color-text-muted] shrink-0">{mixerInput}</span>
      <span className="text-xs font-mono text-[--color-text-primary] truncate flex-1">{url}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="text-xs text-[--color-text-muted] hover:text-orange-500 transition-colors shrink-0"
        title="Copy WHIP endpoint URL"
      >
        {copied ? '✓' : '⎘'}
      </button>
    </div>
  )
}

function SourceAssignmentBadge({ assignment }: { assignment: { sourceId: string; mixerInput: string } }) {
  const source = useSourcesStore((s) => s.sources.find((src) => src.id === assignment.sourceId))
  const name = source?.name ?? VIRTUAL_SOURCE_NAMES[assignment.sourceId] ?? assignment.sourceId
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-[--color-text-primary]">{name}</span>
    </div>
  )
}
