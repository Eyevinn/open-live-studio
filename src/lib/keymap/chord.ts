/**
 * Key-chord encoding for the controller keyboard layer (studio#173).
 *
 * A chord is a plain string: zero or more modifier tokens followed by a
 * `KeyboardEvent.code`, joined with `+`. Modifiers always appear in the
 * canonical order Ctrl, Alt, Shift, Meta so a chord has exactly one textual
 * form. `code` (not `key`) is used so bindings are layout-stable and unaffected
 * by Shift changing the produced character. Examples: `Space`, `KeyF`,
 * `Digit1`, `Shift+Digit1`.
 */

export type KeyChord = string

/** The subset of a `KeyboardEvent` needed to compute a chord. */
export interface ChordSource {
  readonly code: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
}

/** Encode a key event (or event-like object) as its canonical chord string. */
export function eventToChord(event: ChordSource): KeyChord {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')
  parts.push(event.code)
  return parts.join('+')
}

const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight',
])

/**
 * True when a `KeyboardEvent.code` identifies a bare modifier key. Chord capture
 * waits for a non-modifier key before recording a chord, so pressing just Shift
 * (etc.) never produces a binding like `Shift+ShiftLeft`.
 */
export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code)
}

/** Modifier token → human-readable label (platform-neutral). */
const MODIFIER_LABELS: Readonly<Record<string, string>> = {
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Meta: 'Cmd',
}

const ARROW_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}

/** Render a single `KeyboardEvent.code` as a readable key label. */
function formatCode(code: string): string {
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`
  if (/^F[0-9]{1,2}$/.test(code)) return code
  if (code in ARROW_LABELS) return ARROW_LABELS[code] ?? code
  return code
}

/**
 * Render a canonical chord string as a human-readable label for display in the
 * keyboard-shortcuts settings UI, e.g. `Shift+Digit1` → `Shift + 1`, `KeyF` →
 * `F`, `Ctrl+KeyW` → `Ctrl + W`.
 */
export function formatChord(chord: KeyChord): string {
  const parts = chord.split('+')
  const code = parts[parts.length - 1] ?? ''
  const modifiers = parts.slice(0, -1).map((m) => MODIFIER_LABELS[m] ?? m)
  return [...modifiers, formatCode(code)].join(' + ')
}
