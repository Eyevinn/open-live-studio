/**
 * Keyboard-shortcuts settings dialog (studio#174).
 *
 * Lets the operator rebind any action in the keymap-as-data registry (studio#173)
 * by capturing a key chord, with live conflict detection and a reset-to-default.
 * Edits are held in a local draft and only persisted to the keymap store (and
 * thus `localStorage`) on Save, so Cancel reliably discards everything.
 *
 * Capture rules:
 *  - a bare modifier press is ignored; we wait for a real key,
 *  - browser-reserved chords (Ctrl/Cmd+1–9, Ctrl/Cmd+W, Ctrl/Cmd+T) are rejected
 *    with an explanation rather than bound to a dead key,
 *  - a chord already bound to another action is flagged as a conflict and not
 *    applied (duplicate bindings are prevented).
 */

import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useKeymapStore } from '@/store/keymap.store'
import {
  ACTION_DEFINITIONS,
  BUS_SLOTS,
  DEFAULT_KEYMAP,
  eventToChord,
  formatChord,
  isModifierCode,
  previewSelectActionId,
  programCutActionId,
  reservedChordReason,
  type ActionId,
  type KeyChord,
  type Keymap,
} from '@/lib/keymap'

interface KeyboardShortcutsDialogProps {
  open: boolean
  onClose: () => void
}

type Feedback = {
  actionId: ActionId
  kind: 'reserved' | 'conflict'
  message: string
}

const ACTION_GROUPS: readonly { label: string; actions: readonly ActionId[] }[] = [
  {
    label: 'Transitions',
    actions: ['transition.cut', 'transition.auto', 'transition.ftb', 'dsk.toggleLayer0'],
  },
  {
    label: 'Preview bus',
    actions: BUS_SLOTS.map(previewSelectActionId),
  },
  {
    label: 'Program bus (hot-cut)',
    actions: BUS_SLOTS.map(programCutActionId),
  },
]

/** The chord currently bound to `actionId` in `keymap`, if any. */
function chordForAction(keymap: Keymap, actionId: ActionId): KeyChord | undefined {
  return Object.keys(keymap).find((chord) => keymap[chord] === actionId)
}

/** Remove every chord mapped to `actionId`, then bind `chord` to it. */
function rebind(keymap: Keymap, actionId: ActionId, chord: KeyChord): Keymap {
  const next: Keymap = {}
  for (const [existingChord, existingAction] of Object.entries(keymap)) {
    if (existingAction !== actionId) next[existingChord] = existingAction
  }
  next[chord] = actionId
  return next
}

function clearBinding(keymap: Keymap, actionId: ActionId): Keymap {
  const next: Keymap = {}
  for (const [chord, action] of Object.entries(keymap)) {
    if (action !== actionId) next[chord] = action
  }
  return next
}

export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  const keymap = useKeymapStore((s) => s.keymap)
  const setKeymap = useKeymapStore((s) => s.setKeymap)

  const [draft, setDraft] = useState<Keymap>(keymap)
  const [capturing, setCapturing] = useState<ActionId | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  // Re-seed the draft from the live keymap each time the dialog opens so Cancel
  // discards edits and re-opening always reflects persisted state.
  useEffect(() => {
    if (open) {
      setDraft(keymap)
      setCapturing(null)
      setFeedback(null)
    }
  }, [open, keymap])

  // Read the draft from a ref inside the capture listener so it never goes stale
  // without re-subscribing the listener on every keystroke of the draft.
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    if (!open || capturing === null) return
    const actionId = capturing

    const onKeyDown = (event: KeyboardEvent) => {
      // Swallow the event so it never reaches the controller dispatcher while we
      // are capturing a replacement binding.
      event.preventDefault()
      event.stopPropagation()

      if (event.code === 'Escape') {
        setCapturing(null)
        return
      }
      if (isModifierCode(event.code)) return // wait for a non-modifier key

      const chord = eventToChord(event)

      const reserved = reservedChordReason(chord)
      if (reserved) {
        setFeedback({ actionId, kind: 'reserved', message: reserved })
        return
      }

      const current = draftRef.current
      const clash = current[chord]
      if (clash !== undefined && clash !== actionId) {
        setFeedback({
          actionId,
          kind: 'conflict',
          message: `${formatChord(chord)} is already bound to "${ACTION_DEFINITIONS[clash].description}".`,
        })
        return
      }

      setDraft(rebind(current, actionId, chord))
      setFeedback(null)
      setCapturing(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, capturing])

  function startCapture(actionId: ActionId) {
    setFeedback(null)
    setCapturing(actionId)
  }

  function handleClear(actionId: ActionId) {
    setDraft((d) => clearBinding(d, actionId))
    if (capturing === actionId) setCapturing(null)
    if (feedback?.actionId === actionId) setFeedback(null)
  }

  function handleReset() {
    setDraft({ ...DEFAULT_KEYMAP })
    setCapturing(null)
    setFeedback(null)
  }

  function handleSave() {
    setKeymap(draft)
    onClose()
  }

  return (
    <Modal open={open} title="Keyboard Shortcuts" onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-[--color-text-muted]">
          Click a shortcut to rebind it, then press the key combination you want.
          Press Esc to cancel. Browser-reserved combinations (Ctrl/Cmd + 1–9, W, T)
          cannot be used.
        </p>

        {ACTION_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              {group.label}
            </span>
            <div className="flex flex-col border border-zinc-800 rounded overflow-hidden">
              {group.actions.map((actionId) => {
                const chord = chordForAction(draft, actionId)
                const isCapturing = capturing === actionId
                const rowFeedback = feedback?.actionId === actionId ? feedback : null
                return (
                  <div
                    key={actionId}
                    className="flex items-center gap-3 px-3 py-2 border-b border-zinc-800 last:border-b-0"
                  >
                    <span className="flex-1 min-w-0 text-sm text-[--color-text-primary] truncate">
                      {ACTION_DEFINITIONS[actionId].description}
                    </span>

                    {rowFeedback && (
                      <span className="text-[10px] text-[#f96c6c] text-right max-w-[260px]">
                        {rowFeedback.message}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => (isCapturing ? setCapturing(null) : startCapture(actionId))}
                      className={
                        isCapturing
                          ? 'shrink-0 w-32 px-2 py-1 text-xs font-mono rounded border border-orange-500 text-orange-500 animate-pulse cursor-pointer'
                          : 'shrink-0 w-32 px-2 py-1 text-xs font-mono rounded border border-zinc-700 text-[--color-text-primary] hover:border-orange-500 hover:text-orange-500 transition-colors cursor-pointer'
                      }
                    >
                      {isCapturing ? 'Press keys…' : chord ? formatChord(chord) : 'Unassigned'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleClear(actionId)}
                      disabled={chord === undefined}
                      title="Clear binding"
                      className="shrink-0 w-6 text-center text-sm text-[--color-text-muted] hover:text-[#f96c6c] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" size="sm" onClick={handleReset}>
            Reset to defaults
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
