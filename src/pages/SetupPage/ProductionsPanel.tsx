import { useState, useEffect } from 'react'
import { useProductionsStore, type Production } from '@/store/productions.store'
import { useProductionStore } from '@/store/production.store'
import { useSourcesStore } from '@/store/sources.store'
import { useTemplatesStore } from '@/store/templates.store'
import { productionsApi } from '@/lib/api'
import type { ApiTemplate } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { StatusDot } from '@/components/ui/StatusDot'
import { Modal } from '@/components/ui/Modal'

// ---------------------------------------------------------------------------
// Shared select style
// ---------------------------------------------------------------------------

const selectCls =
  'w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent] appearance-none cursor-pointer'

const inputCls =
  'w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:ring-1 focus:ring-[--color-accent]'

// ---------------------------------------------------------------------------
// Source slot row — one template input
// ---------------------------------------------------------------------------

interface SlotRowProps {
  slotId: string
  currentSourceId: string
  onChange: (sourceId: string) => void
}

function SlotRow({ slotId, currentSourceId, onChange }: SlotRowProps) {
  const sources = useSourcesStore((s) => s.sources)
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono text-[--color-text-muted] w-28 shrink-0 truncate" title={slotId}>
        {slotId}
      </span>
      <select value={currentSourceId} onChange={(e) => onChange(e.target.value)} className={selectCls}>
        <option value="">— unassigned —</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.streamType.toUpperCase()})
          </option>
        ))}
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Configure sources modal — for an existing production
// ---------------------------------------------------------------------------

interface ConfigureModalProps {
  production: Production
  template: ApiTemplate
  onClose: () => void
}

function ConfigureSourcesModal({ production, template, onClose }: ConfigureModalProps) {
  const { assignSource, unassignSource } = useProductionsStore()

  // Local copy so UI updates immediately without a re-fetch
  const [assignments, setAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(production.sources.map((s) => [s.mixerInput, s.sourceId]))
  )

  async function handleChange(mixerInput: string, sourceId: string) {
    setAssignments((prev) => ({ ...prev, [mixerInput]: sourceId }))
    if (sourceId) {
      await assignSource(production.id, { mixerInput, sourceId })
    } else {
      await unassignSource(production.id, mixerInput)
    }
  }

  const assigned = Object.values(assignments).filter(Boolean).length
  const total = template.inputs.length

  return (
    <Modal
      open
      title={`Configure Sources — ${production.name}`}
      onClose={onClose}
      className="max-w-xl"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[--color-text-muted]">
            Template: <span className="text-[--color-text-primary] font-medium">{template.name}</span>
          </span>
          <span className={`text-xs font-mono ${assigned === total ? 'text-green-400' : 'text-[--color-text-muted]'}`}>
            {assigned}/{total} assigned
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 pb-1 border-b border-[--color-border]">
            <span className="text-xs uppercase tracking-wider text-[--color-text-muted] w-28 shrink-0">Input slot</span>
            <span className="text-xs uppercase tracking-wider text-[--color-text-muted]">Source</span>
          </div>
          {template.inputs.map((slot) => (
            <SlotRow
              key={slot.id}
              slotId={slot.id}
              currentSourceId={assignments[slot.id] ?? ''}
              onChange={(sourceId) => handleChange(slot.id, sourceId)}
            />
          ))}
        </div>

        {template.inputs.length === 0 && (
          <p className="text-sm text-[--color-text-muted] text-center py-4">
            This template has no input slots defined.
          </p>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="active" onClick={onClose}>Done</Button>
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

function CreateProductionModal({ onClose, onCreated }: CreateModalProps) {
  const { fetchAll } = useProductionsStore()
  const templates = useTemplatesStore((s) => s.templates)
  const sources = useSourcesStore((s) => s.sources)

  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Reset assignments when template changes
  useEffect(() => { setAssignments({}) }, [templateId])

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)
    try {
      // 1. Create the production
      const prod = await productionsApi.create({ name: name.trim() })

      // 2. Set template
      if (templateId) {
        await productionsApi.update(prod.id, { templateId })
      }

      // 3. Assign sources
      for (const [mixerInput, sourceId] of Object.entries(assignments)) {
        if (sourceId) {
          await productionsApi.assignSource(prod.id, { mixerInput, sourceId })
        }
      }

      // 4. Sync store
      await fetchAll()
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  const assignedCount = Object.values(assignments).filter(Boolean).length
  const totalSlots = selectedTemplate?.inputs.length ?? 0

  return (
    <Modal open title="New Production" onClose={onClose} className="max-w-xl">
      <div className="flex flex-col gap-4">
        {/* Name */}
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

        {/* Template selector */}
        <div>
          <label className="text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1">
            Flow Template <span className="normal-case text-[--color-text-muted]">(optional)</span>
          </label>
          {templates.length === 0 ? (
            <p className="text-xs text-[--color-text-muted] py-2">
              No templates found. Create one via the API to enable Strom flow activation.
            </p>
          ) : (
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={selectCls}>
              <option value="">— none —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Source assignment slots — only shown when a template is selected */}
        {selectedTemplate && selectedTemplate.inputs.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between border-t border-[--color-border] pt-3">
              <span className="text-xs uppercase tracking-wider text-[--color-text-muted]">
                Assign Sources
              </span>
              <span className={`text-xs font-mono ${assignedCount === totalSlots ? 'text-green-400' : 'text-[--color-text-muted]'}`}>
                {assignedCount}/{totalSlots}
              </span>
            </div>

            {sources.length === 0 ? (
              <p className="text-xs text-[--color-text-muted] py-1">
                No sources available. Add sources in the Sources tab first.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3 pb-1 border-b border-[--color-border]">
                  <span className="text-xs text-[--color-text-muted] w-28 shrink-0">Input slot</span>
                  <span className="text-xs text-[--color-text-muted]">Source</span>
                </div>
                {selectedTemplate.inputs.map((slot) => (
                  <SlotRow
                    key={slot.id}
                    slotId={slot.id}
                    currentSourceId={assignments[slot.id] ?? ''}
                    onChange={(sourceId) =>
                      setAssignments((prev) => ({ ...prev, [slot.id]: sourceId }))
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="active" onClick={() => void handleCreate()} disabled={!name.trim() || saving}>
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
  const { fetchAll: fetchTemplates, templates } = useTemplatesStore()

  const [addOpen, setAddOpen] = useState(false)
  const [configuringId, setConfiguringId] = useState<string | null>(null)

  // Fetch templates when panel mounts
  useEffect(() => {
    void fetchTemplates()
  }, [fetchTemplates])

  async function handleDelete(id: string) {
    await removeProduction(id)
    if (activeProductionId === id) setActiveProduction(null)
  }

  const configuringProd = configuringId ? productions.find((p) => p.id === configuringId) : null
  const configuringTemplate = configuringProd?.templateId
    ? templates.find((t) => t.id === configuringProd.templateId)
    : null

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
        {productions.map((prod) => {
          const isActive = prod.status === 'active'
          const template = templates.find((t) => t.id === prod.templateId)
          const assignedCount = prod.sources.length
          const totalSlots = template?.inputs.length ?? 0

          return (
            <div
              key={prod.id}
              className={`flex flex-col gap-2 px-4 py-3 rounded border transition-colors ${
                isActive
                  ? 'bg-[--color-surface-3] border-[--color-accent]'
                  : 'bg-[--color-surface-3] border-[--color-border] hover:border-zinc-600'
              }`}
            >
              {/* Top row */}
              <div className="flex items-center gap-3">
                <StatusDot color={isActive ? 'red' : 'gray'} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-[--color-text-primary] truncate block">
                    {prod.name}
                  </span>
                  {template ? (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-[--color-text-muted] truncate">{template.name}</span>
                      <span className={`text-xs font-mono ${assignedCount === totalSlots && totalSlots > 0 ? 'text-green-400' : 'text-[--color-text-muted]'}`}>
                        {assignedCount}/{totalSlots} sources
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-[--color-text-muted] mt-0.5 block">No template</span>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {prod.templateId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfiguringId(prod.id)}
                    >
                      ⚙ Sources
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={isActive ? 'ghost' : 'pvw'}
                    onClick={() => {
                      void updateStatus(prod.id, isActive ? 'inactive' : 'active')
                      setActiveProduction(isActive ? null : prod.id)
                    }}
                  >
                    {isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(prod.id)}
                    className="opacity-40 hover:opacity-100"
                  >
                    ✕
                  </Button>
                </div>
              </div>

              {/* Source assignment summary row */}
              {prod.templateId && template && prod.sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-6">
                  {prod.sources.map((a) => (
                    <SourceAssignmentBadge key={a.mixerInput} assignment={a} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Create modal */}
      {addOpen && (
        <CreateProductionModal
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); void fetchAll() }}
        />
      )}

      {/* Configure sources modal */}
      {configuringProd && configuringTemplate && (
        <ConfigureSourcesModal
          production={configuringProd}
          template={configuringTemplate}
          onClose={() => setConfiguringId(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small badge showing mixerInput → source name
// ---------------------------------------------------------------------------

function SourceAssignmentBadge({ assignment }: { assignment: { sourceId: string; mixerInput: string } }) {
  const source = useSourcesStore((s) => s.sources.find((src) => src.id === assignment.sourceId))
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-[--color-surface-raised] border border-[--color-border] text-[--color-text-muted]">
      <span className="text-[--color-text-primary] font-mono">{assignment.mixerInput}</span>
      <span>→</span>
      <span>{source?.name ?? assignment.sourceId}</span>
    </span>
  )
}
