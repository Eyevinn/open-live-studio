/**
 * Keymap-as-data action registry + dispatcher (studio#173).
 *
 * Public surface for the controller keyboard layer: a stable action vocabulary,
 * a serialisable keymap with a default seeded from the old hardcoded shortcuts,
 * a central dispatcher, and a React hook to wire it to the window.
 */

export {
  ACTION_DEFINITIONS,
  ACTION_IDS,
  BUS_SLOTS,
  isActionId,
  previewSelectActionId,
  programCutActionId,
  type ActionDefinition,
  type ActionHandler,
  type ActionHandlers,
  type ActionId,
  type BusSlot,
  type PreviewSelectActionId,
  type ProgramCutActionId,
} from './actions'

export {
  eventToChord,
  formatChord,
  isModifierCode,
  type ChordSource,
  type KeyChord,
} from './chord'

export { RESERVED_CHORDS, isReservedChord, reservedChordReason } from './reserved'

export {
  DEFAULT_KEYMAP,
  KEYMAP_STORAGE_KEY,
  loadKeymap,
  saveKeymap,
  type Keymap,
} from './keymap'

export { dispatchKeyboardEvent, resolveActionId } from './dispatcher'

export { useKeymapDispatcher, type UseKeymapDispatcherOptions } from './useKeymapDispatcher'
