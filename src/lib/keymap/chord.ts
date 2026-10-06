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
