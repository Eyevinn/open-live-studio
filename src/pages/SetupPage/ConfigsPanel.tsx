import { useState, useEffect } from 'react'
import { productionConfigsApi } from '@/lib/api'
import type { ProductionConfig } from '@/lib/api'
import { PRODUCTION_PROPERTIES } from '@/lib/production-schema'
import { ConfigFieldGroup, inputCls } from '@/components/ui/ProductionConfigFields'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useIsPhone } from '@/hooks/usePhoneLayout'

const tProps = PRODUCTION_PROPERTIES

function defaultValues(): Record<string, string | number | boolean> {
  return Object.fromEntries(tProps.map((p) => [p.id, p.default]))
}

function cfgOnChange(
  values: Record<string, string | number | boolean>,
  setValues: React.Dispatch<React.SetStateAction<Record<string, string | number | boolean>>>,
) {
  return (id: string, v: string | number | boolean) => setValues((prev) => ({ ...prev, [id]: v }))
}

// ---------------------------------------------------------------------------
// Two-column config layout — identical to the production modal config side
// ---------------------------------------------------------------------------

function ConfigLayout({
  values,
  onChange,
}: {
  values: Record<string, string | number | boolean>
  onChange: (id: string, v: string | number | boolean) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-x-12 gap-y-4">
      <div className="flex flex-col gap-4">
        <ConfigFieldGroup label="Strom"       ids={['mix_latency', 'clock']}                          properties={tProps} values={values} onChange={onChange} />
        <ConfigFieldGroup label="PGM"         ids={['pgm_resolution', 'pgm_framerate', 'bitrate']}    properties={tProps} values={values} onChange={onChange} />
      </div>
      <div className="flex flex-col gap-4">
        <ConfigFieldGroup label="Multiviewer" ids={['multiview_resolution', 'multiview_framerate', 'multiview_bitrate', 'swap_pvw_pgm']} properties={tProps} values={values} onChange={onChange} />
        <ConfigFieldGroup label="Audio"       ids={['num_aux_buses', 'num_groups', 'ebu_main']}       properties={tProps} values={values} onChange={onChange} />
        <ConfigFieldGroup label="Picture in Picture" ids={['num_pips']}                               properties={tProps} values={values} onChange={onChange} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------

function CreateConfigModal({ onSave, onClose }: { onSave: (cfg: ProductionConfig) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [values, setValues] = useState(defaultValues)
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const created = await productionConfigsApi.create({ name: name.trim(), values })
      onSave(created)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open title="New Config" onClose={onClose} className="max-w-3xl">
      <div className="flex flex-col gap-6">
        <div>
          <label className="text-xs text-orange-500 uppercase tracking-wider block mb-1">Name</label>
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !saving) void handleCreate() }}
            placeholder="HD Standard"
            className={inputCls}
          />
        </div>
        <ConfigLayout values={values} onChange={cfgOnChange(values, setValues)} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="active" onClick={() => void handleCreate()} disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

function EditConfigModal({ config, onSave, onClose }: { config: ProductionConfig; onSave: (updated: ProductionConfig) => void; onClose: () => void }) {
  const [name, setName] = useState(config.name)
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => ({ ...config.values }))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const updated = await productionConfigsApi.update(config._id, { name: name.trim(), values })
      onSave(updated)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open title={`Edit Config — ${config.name}`} onClose={onClose} className="max-w-3xl">
      <div className="flex flex-col gap-6">
        <div>
          <label className="text-xs text-orange-500 uppercase tracking-wider block mb-1">Name</label>
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !saving) void handleSave() }}
            className={inputCls}
          />
        </div>
        <ConfigLayout values={values} onChange={cfgOnChange(values, setValues)} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="active" onClick={() => void handleSave()} disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Configs panel
// ---------------------------------------------------------------------------

export function ConfigsPanel() {
  // Phone tier (<768px): read-only. Hide every state-mutating control (#105).
  const isPhone = useIsPhone()
  const [configs, setConfigs] = useState<ProductionConfig[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ProductionConfig | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProductionConfig | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setIsLoading(true)
    try {
      const data = await productionConfigsApi.list()
      setConfigs(data)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleDelete(config: ProductionConfig) {
    await productionConfigsApi.remove(config._id)
    setConfigs((prev) => prev.filter((c) => c._id !== config._id))
    setDeleteTarget(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[--color-text-muted] font-mono">
          {configs.length} {configs.length === 1 ? 'config' : 'configs'}
          {isLoading && <span className="ml-2 text-[--color-accent]">Loading…</span>}
        </span>
        {!isPhone && (
          <Button size="sm" variant="active" onClick={() => setAddOpen(true)}>+ New Config</Button>
        )}
      </div>

      {configs.length === 0 && !isLoading && (
        <p className="text-sm text-[--color-text-muted] py-4">No saved configs yet.</p>
      )}

      <div className="flex flex-col gap-1">
        {configs.map((cfg) => (
          <div
            key={cfg._id}
            className={`flex items-center gap-3 px-4 py-3 rounded bg-[--color-surface-3] border border-[--color-border] transition-colors ${isPhone ? 'cursor-default' : 'hover:border-orange-500 cursor-pointer'}`}
            // Phone tier: the config editor is a state-mutating form, so rows are
            // inert (glanceable list only) at <768px (#105).
            onClick={() => { if (!isPhone) setEditTarget(cfg) }}
          >
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-[--color-text-primary] truncate block">{cfg.name}</span>
              <span className="text-xs text-[--color-text-muted] font-mono truncate block">
                {Object.entries(cfg.values).map(([, v]) => String(v)).join(' · ')}
              </span>
            </div>
            {/* Phone tier (<768px): hide state-mutating controls (edit/delete) (#105). */}
            {!isPhone && (
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditTarget(cfg) }}>Edit</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(cfg) }}
                  className="text-white hover:text-red-400"
                >
                  Delete
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {addOpen && (
        <CreateConfigModal
          onSave={(cfg) => { setConfigs((prev) => [...prev, cfg]); setAddOpen(false) }}
          onClose={() => setAddOpen(false)}
        />
      )}

      {editTarget && (
        <EditConfigModal
          config={editTarget}
          onSave={(updated) => { setConfigs((prev) => prev.map((c) => (c._id === updated._id ? updated : c))); setEditTarget(null) }}
          onClose={() => setEditTarget(null)}
        />
      )}

      {deleteTarget && (
        <Modal open title="Delete Config" onClose={() => setDeleteTarget(null)} className="max-w-sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[--color-text-primary]">
              Delete <span className="font-semibold">{deleteTarget.name}</span>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void handleDelete(deleteTarget)}>Delete</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
