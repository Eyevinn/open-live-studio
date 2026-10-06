/**
 * Keyboard-shortcuts help overlay (studio#175).
 *
 * A read-only cheat sheet of the *active* keymap, opened by pressing `?` on the
 * controller. Bindings are rendered grouped by action (reusing the shared
 * {@link ACTION_GROUPS} ordering and the human-readable
 * {@link ACTION_DEFINITIONS} descriptions) so operators can discover and recall
 * shortcuts without entering the rebinding dialog. Editing lives in
 * {@link KeyboardShortcutsDialog} (studio#174); this overlay never mutates state.
 */

import { Modal } from '@/components/ui/Modal'
import {
  ACTION_DEFINITIONS,
  ACTION_GROUPS,
  formatChord,
  type ActionId,
  type Keymap,
} from '@/lib/keymap'

interface ShortcutsHelpOverlayProps {
  open: boolean
  onClose: () => void
  keymap: Keymap
}

/** Every chord bound to `actionId`, in keymap order (usually one, possibly none). */
function chordsForAction(keymap: Keymap, actionId: ActionId): string[] {
  return Object.keys(keymap).filter((chord) => keymap[chord] === actionId)
}

export function ShortcutsHelpOverlay({ open, onClose, keymap }: ShortcutsHelpOverlayProps) {
  return (
    <Modal open={open} title="Keyboard Shortcuts" onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-[--color-text-muted]">
          The shortcuts currently active on this controller. Use the keyboard icon
          in the Controller panel to rebind them.
        </p>

        {ACTION_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              {group.label}
            </span>
            <div className="flex flex-col border border-zinc-800 rounded overflow-hidden">
              {group.actions.map((actionId) => {
                const chords = chordsForAction(keymap, actionId)
                return (
                  <div
                    key={actionId}
                    className="flex items-center gap-3 px-3 py-2 border-b border-zinc-800 last:border-b-0"
                  >
                    <span className="flex-1 min-w-0 text-sm text-[--color-text-primary] truncate">
                      {ACTION_DEFINITIONS[actionId].description}
                    </span>
                    <span className="shrink-0 flex items-center gap-1 flex-wrap justify-end">
                      {chords.length === 0 ? (
                        <span className="text-xs italic text-[--color-text-muted]">Unassigned</span>
                      ) : (
                        chords.map((chord) => (
                          <kbd
                            key={chord}
                            className="px-2 py-1 text-xs font-mono rounded border border-zinc-700 text-[--color-text-primary]"
                          >
                            {formatChord(chord)}
                          </kbd>
                        ))
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
