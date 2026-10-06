/**
 * Action vocabulary for the controller keyboard layer (studio#173).
 *
 * Every action ID is a stable identifier for a discrete operator action that was
 * previously triggered by a hardcoded key handler in `ControllerPage` /
 * `PanePage`. The keymap (`keymap.ts`) maps key chords to these IDs; the
 * dispatcher (`dispatcher.ts`) resolves a key event to an ID and invokes the
 * matching handler supplied by the page.
 *
 * These IDs are the public contract that the (future) keymap settings UI
 * (studio#174) and help overlay (studio#175) will consume — treat them as
 * stable and additive-only.
 */

/** Program/preview bus slots addressable from the number row (`1`–`9`). */
export type BusSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export const BUS_SLOTS: readonly BusSlot[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

export type PreviewSelectActionId = `bus.preview.${BusSlot}`
export type ProgramCutActionId = `bus.program.${BusSlot}`

export type ActionId =
  | 'transition.cut'
  | 'transition.auto'
  | 'transition.ftb'
  | 'dsk.toggleLayer0'
  | PreviewSelectActionId
  | ProgramCutActionId

export const previewSelectActionId = (slot: BusSlot): PreviewSelectActionId =>
  `bus.preview.${slot}`
export const programCutActionId = (slot: BusSlot): ProgramCutActionId =>
  `bus.program.${slot}`

export interface ActionDefinition {
  readonly id: ActionId
  /** Short human-readable label (for the future settings UI / help overlay). */
  readonly description: string
}

function buildActionDefinitions(): Readonly<Record<ActionId, ActionDefinition>> {
  const defs: Record<ActionId, ActionDefinition> = {
    'transition.cut':   { id: 'transition.cut',   description: 'Cut / take preview to program' },
    'transition.auto':  { id: 'transition.auto',  description: 'Auto-transition preview to program' },
    'transition.ftb':   { id: 'transition.ftb',   description: 'Fade to black' },
    'dsk.toggleLayer0': { id: 'dsk.toggleLayer0', description: 'Toggle downstream keyer layer 1' },
  } as Record<ActionId, ActionDefinition>

  for (const slot of BUS_SLOTS) {
    const preview = previewSelectActionId(slot)
    defs[preview] = { id: preview, description: `Select bus input ${slot} on preview` }
    const program = programCutActionId(slot)
    defs[program] = { id: program, description: `Cut bus input ${slot} to program` }
  }

  return defs
}

/** The action registry: every known action ID with its metadata. */
export const ACTION_DEFINITIONS = buildActionDefinitions()

/** A labelled, display-ordered cluster of related actions. */
export interface ActionGroup {
  readonly label: string
  readonly actions: readonly ActionId[]
}

/**
 * Presentation grouping of the action vocabulary, shared by the keymap settings
 * dialog (studio#174) and the shortcuts help overlay (studio#175) so both render
 * the same actions in the same order under the same headings.
 */
export const ACTION_GROUPS: readonly ActionGroup[] = [
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

/** All known action IDs. */
export const ACTION_IDS: readonly ActionId[] = Object.keys(ACTION_DEFINITIONS) as ActionId[]

const ACTION_ID_SET: ReadonlySet<string> = new Set<string>(ACTION_IDS)

/** Type guard: is an arbitrary string one of the known action IDs? */
export function isActionId(value: string): value is ActionId {
  return ACTION_ID_SET.has(value)
}

/** Handler invoked by the dispatcher when its action's chord fires. */
export type ActionHandler = (event: KeyboardEvent) => void

/**
 * The actions a page can actually perform. A page registers only the subset it
 * supports; chords resolving to an unregistered action are left to the browser
 * (no `preventDefault`), which is how `PanePage` keeps to Cut/Auto only.
 */
export type ActionHandlers = Partial<Record<ActionId, ActionHandler>>
