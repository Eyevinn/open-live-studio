import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ClipReferenceFields } from '@/components/ui/ClipReferenceFields'
import { inputCls, labelCls } from '@/components/ui/SrtDirectionFields'
import { emptyClipRef, serializeClipRef, validateClipRef, type ClipRefState } from '@/lib/clipRef'
import { useSourcesStore } from '@/store/sources.store'
import { useProductionStore } from '@/store/production.store'

export interface ClipSlot {
  mixerInput: string
  name: string
}

interface NewClipDialogProps {
  open: boolean
  onClose: () => void
  /** Clip slots of the active production, offered as cue targets once the clip is saved. */
  slots: ClipSlot[]
  /** Cues the freshly created clip (by source id) into a slot - the same CLIP_CUE path as the per-slot picker. */
  onCue: (mixerInput: string, clipId: string) => void
}

type Step = { kind: 'form' } | { kind: 'saved'; clipId: string; name: string }

/**
 * "New clip" flow for the Clips panel (studio#203): registers a clip source from a
 * URL or S3 reference without leaving the controller, then offers to cue it into a
 * slot. Reuses ClipReferenceFields/validateClipRef from Setup and the per-slot
 * picker's CLIP_CUE path (via `onCue`).
 */
export function NewClipDialog({ open, onClose, slots, onCue }: NewClipDialogProps) {
  const addSource = useSourcesStore((s) => s.addSource)
  const clipStates = useProductionStore((s) => s.clipStates)

  const [name, setName] = useState('')
  const [ref, setRef] = useState<ClipRefState>({ ...emptyClipRef })
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [slotId, setSlotId] = useState('')

  // Same on-air guard as the per-slot picker: the server rejects CLIP_CUE (409)
  // while a slot is playing.
  const isOnAir = (mixerInput: string) => clipStates[mixerInput]?.state === 'playing'
  const cueable = slots.filter((s) => !isOnAir(s.mixerInput))
  const targetId = cueable.some((s) => s.mixerInput === slotId) ? slotId : (cueable[0]?.mixerInput ?? '')

  function close() {
    setName('')
    setRef({ ...emptyClipRef })
    setError(null)
    setSaveError(null)
    setSaving(false)
    setStep({ kind: 'form' })
    setSlotId('')
    onClose()
  }

  async function handleSave() {
    if (saving) return
    if (!name.trim()) { setError('Name is required'); return }
    const refErr = validateClipRef(ref)
    if (refErr) { setError(refErr); return }
    setSaving(true)
    setSaveError(null)
    try {
      const created = await addSource({
        name: name.trim(),
        address: serializeClipRef(ref),
        streamType: 'clip',
        status: 'inactive',
        color: '#27272a',
      })
      setStep({ kind: 'saved', clipId: created.id, name: created.name })
    } catch (err) {
      setSaveError(err instanceof Error && err.message ? err.message : 'Could not save the clip.')
    } finally {
      setSaving(false)
    }
  }

  if (step.kind === 'saved') {
    const saved = step
    return (
      <Modal
        open={open}
        title="Clip added"
        onClose={close}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Not now</Button>
            <Button
              variant="primary"
              disabled={targetId === ''}
              onClick={() => { onCue(targetId, saved.clipId); close() }}
            >
              Cue into slot
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[--color-text-primary]">
            <span className="font-semibold">{saved.name}</span> is in the clip library.
            {slots.length > 0 && cueable.length > 0 && ' Cue it into a slot now?'}
          </p>
          {slots.length === 0 && (
            <p className="text-xs text-[--color-text-muted]">
              This production has no clip slots. Assign a clip source to a slot in Setup to cue clips here.
            </p>
          )}
          {slots.length > 0 && cueable.length === 0 && (
            <p className="text-xs text-[--color-text-muted]">
              Every clip slot is on air - stop or pause one before cueing the new clip.
            </p>
          )}
          {cueable.length > 0 && (
            <div>
              <label className={labelCls}>Slot</label>
              <select
                value={targetId}
                aria-label="Slot to cue the new clip into"
                onChange={(e) => setSlotId(e.target.value)}
                className={inputCls}
              >
                {slots.map((s) => (
                  <option key={s.mixerInput} value={s.mixerInput} disabled={isOnAir(s.mixerInput)}>
                    {isOnAir(s.mixerInput) ? `${s.name} (on air)` : s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      title="New clip"
      onClose={close}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <label className={labelCls}>Name</label>
          <input
            type="text"
            value={name}
            placeholder="Highlights"
            onChange={(e) => { setName(e.target.value); setError(null) }}
            className={inputCls}
          />
        </div>
        <ClipReferenceFields
          value={ref}
          onChange={(next) => { setRef(next); setError(null) }}
          error={error ?? saveError}
        />
      </div>
    </Modal>
  )
}
