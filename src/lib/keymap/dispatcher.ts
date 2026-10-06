/**
 * Central keyboard dispatcher for the controller keyboard layer (studio#173).
 *
 * The dispatcher is the single place a controller key event is resolved: encode
 * the event as a chord, look up the action ID in the keymap, and — if the page
 * registered a handler for that action — consume the event and invoke it. One
 * resolution path replaces the hand-written `if (e.code === …)` ladders that
 * previously lived in `ControllerPage` and `PanePage`.
 */

import { eventToChord, type ChordSource } from './chord'
import type { Keymap } from './keymap'
import type { ActionHandlers, ActionId } from './actions'

/** Resolve a key event to its mapped action ID, or `null` if unbound. */
export function resolveActionId(keymap: Keymap, event: ChordSource): ActionId | null {
  return keymap[eventToChord(event)] ?? null
}

/** True when the event originates from a text-editing field we must not hijack. */
function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

/**
 * Resolve and run a key event against a keymap + handler set.
 *
 * Returns `true` when the event was handled (an action ran). Only events that
 * resolve to an action the caller actually registered are consumed via
 * `preventDefault`; everything else is left untouched for the browser — this is
 * what lets a page expose a subset of the keymap (e.g. `PanePage` → Cut/Auto).
 */
export function dispatchKeyboardEvent(
  event: KeyboardEvent,
  keymap: Keymap,
  handlers: ActionHandlers,
): boolean {
  if (isTextEntryTarget(event.target)) return false

  const actionId = resolveActionId(keymap, event)
  if (!actionId) return false

  const handler = handlers[actionId]
  if (!handler) return false

  event.preventDefault()
  handler(event)
  return true
}
