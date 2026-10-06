/**
 * Browser-reserved key chords for the controller keyboard layer (studio#174).
 *
 * Some chords are owned by the browser (tab switching, close/new tab) and cannot
 * be reliably intercepted with `preventDefault`. The keymap settings UI rejects
 * attempts to bind an action to one of these, with an explanation, so an
 * operator never ends up with a "dead" binding that silently closes their tab
 * mid-show. We flag both the `Ctrl` and `Meta` (⌘, Mac) forms since the same
 * chords are reserved across platforms.
 */

import { BUS_SLOTS } from './actions'
import type { KeyChord } from './chord'

function buildReservedChords(): ReadonlyMap<KeyChord, string> {
  const reserved = new Map<KeyChord, string>()

  // Ctrl/Cmd + 1–9: the browser uses these to jump between tabs.
  const tabSwitchReason =
    'Ctrl/Cmd + 1–9 is reserved by the browser for switching tabs.'
  for (const slot of BUS_SLOTS) {
    reserved.set(`Ctrl+Digit${slot}`, tabSwitchReason)
    reserved.set(`Meta+Digit${slot}`, tabSwitchReason)
  }

  // Ctrl/Cmd + W closes the tab; Ctrl/Cmd + T opens a new one.
  reserved.set('Ctrl+KeyW', 'Ctrl/Cmd + W is reserved by the browser for closing the tab.')
  reserved.set('Meta+KeyW', 'Ctrl/Cmd + W is reserved by the browser for closing the tab.')
  reserved.set('Ctrl+KeyT', 'Ctrl/Cmd + T is reserved by the browser for opening a new tab.')
  reserved.set('Meta+KeyT', 'Ctrl/Cmd + T is reserved by the browser for opening a new tab.')

  return reserved
}

/** Chords the browser owns and we refuse to bind, keyed to an explanation. */
export const RESERVED_CHORDS: ReadonlyMap<KeyChord, string> = buildReservedChords()

/**
 * If `chord` is a browser-reserved combination, return a human-readable reason it
 * cannot be bound; otherwise return `null`.
 */
export function reservedChordReason(chord: KeyChord): string | null {
  return RESERVED_CHORDS.get(chord) ?? null
}

/** Convenience predicate over {@link reservedChordReason}. */
export function isReservedChord(chord: KeyChord): boolean {
  return RESERVED_CHORDS.has(chord)
}
