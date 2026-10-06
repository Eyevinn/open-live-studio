/**
 * Keymap-as-data for the controller keyboard layer (studio#173).
 *
 * A keymap is a plain `chord -> action ID` record — serialisable, inspectable,
 * and (from studio#174) user-editable. The default keymap below reproduces the
 * previously hardcoded shortcuts exactly, so out-of-the-box behaviour is
 * unchanged. The active keymap is persisted to `localStorage` for the current
 * browser.
 */

import {
  BUS_SLOTS,
  isActionId,
  previewSelectActionId,
  programCutActionId,
  type ActionId,
} from './actions'
import type { KeyChord } from './chord'

export type Keymap = Record<KeyChord, ActionId>

function buildDefaultKeymap(): Keymap {
  const map: Keymap = {
    Space: 'transition.cut',
    Enter: 'transition.auto',
    KeyF: 'transition.ftb',
    KeyK: 'dsk.toggleLayer0',
  }
  // Number row: `1`–`9` select the matching bus input on preview; Shift+`1`–`9`
  // hot-cut it straight to program. Mirrors the old Digit/Shift+Digit handler.
  for (const slot of BUS_SLOTS) {
    map[`Digit${slot}`] = previewSelectActionId(slot)
    map[`Shift+Digit${slot}`] = programCutActionId(slot)
  }
  return map
}

/** The shipped keymap, seeded from the pre-existing hardcoded shortcuts. */
export const DEFAULT_KEYMAP: Keymap = buildDefaultKeymap()

export const KEYMAP_STORAGE_KEY = 'ol-studio-keymap'

/**
 * Load the persisted keymap, falling back to {@link DEFAULT_KEYMAP} when nothing
 * is stored or the stored value is malformed. Entries whose action ID is not a
 * known action (e.g. left over from an older build) are dropped.
 */
export function loadKeymap(): Keymap {
  try {
    const raw = localStorage.getItem(KEYMAP_STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Keymap = {}
        for (const [chord, actionId] of Object.entries(parsed as Record<string, unknown>)) {
          if (chord.length > 0 && typeof actionId === 'string' && isActionId(actionId)) {
            out[chord] = actionId
          }
        }
        if (Object.keys(out).length > 0) return out
      }
    }
  } catch {
    // intentionally empty — malformed/inaccessible localStorage falls back to defaults
  }
  return { ...DEFAULT_KEYMAP }
}

/** Persist the active keymap. Best-effort — storage errors are swallowed. */
export function saveKeymap(keymap: Keymap): void {
  try {
    localStorage.setItem(KEYMAP_STORAGE_KEY, JSON.stringify(keymap))
  } catch {
    // intentionally empty — best-effort persistence; ignore quota/availability errors
  }
}
