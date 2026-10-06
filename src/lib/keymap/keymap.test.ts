import { describe, it, expect } from 'vitest'
import { eventToChord, type ChordSource } from './chord'
import { DEFAULT_KEYMAP } from './keymap'
import { resolveActionId } from './dispatcher'
import { ACTION_DEFINITIONS, BUS_SLOTS, isActionId } from './actions'

function chordSource(code: string, mods: Partial<Omit<ChordSource, 'code'>> = {}): ChordSource {
  return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }
}

describe('eventToChord', () => {
  it('encodes a bare key as its code', () => {
    expect(eventToChord(chordSource('Space'))).toBe('Space')
    expect(eventToChord(chordSource('Digit1'))).toBe('Digit1')
  })

  it('prefixes modifiers in canonical Ctrl+Alt+Shift+Meta order', () => {
    expect(eventToChord(chordSource('Digit1', { shiftKey: true }))).toBe('Shift+Digit1')
    expect(
      eventToChord(chordSource('KeyF', { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true })),
    ).toBe('Ctrl+Alt+Shift+Meta+KeyF')
  })
})

describe('DEFAULT_KEYMAP', () => {
  it('reproduces the previously hardcoded controller shortcuts exactly', () => {
    expect(DEFAULT_KEYMAP.Space).toBe('transition.cut')
    expect(DEFAULT_KEYMAP.Enter).toBe('transition.auto')
    expect(DEFAULT_KEYMAP.KeyF).toBe('transition.ftb')
    expect(DEFAULT_KEYMAP.KeyK).toBe('dsk.toggleLayer0')
    for (const slot of BUS_SLOTS) {
      expect(DEFAULT_KEYMAP[`Digit${slot}`]).toBe(`bus.preview.${slot}`)
      expect(DEFAULT_KEYMAP[`Shift+Digit${slot}`]).toBe(`bus.program.${slot}`)
    }
  })

  it('binds exactly the expected number of chords (4 + 9 + 9)', () => {
    expect(Object.keys(DEFAULT_KEYMAP)).toHaveLength(22)
  })

  it('only maps to known, registered action IDs', () => {
    for (const actionId of Object.values(DEFAULT_KEYMAP)) {
      expect(isActionId(actionId)).toBe(true)
      expect(ACTION_DEFINITIONS[actionId]).toBeDefined()
    }
  })
})

describe('resolveActionId', () => {
  it('resolves a bound chord to its action ID', () => {
    expect(resolveActionId(DEFAULT_KEYMAP, chordSource('Space'))).toBe('transition.cut')
    expect(resolveActionId(DEFAULT_KEYMAP, chordSource('Digit3'))).toBe('bus.preview.3')
    expect(resolveActionId(DEFAULT_KEYMAP, chordSource('Digit3', { shiftKey: true }))).toBe('bus.program.3')
  })

  it('returns null for an unbound chord', () => {
    expect(resolveActionId(DEFAULT_KEYMAP, chordSource('KeyZ'))).toBeNull()
    // Shift distinguishes preview vs program, so Shift+Space is not Space.
    expect(resolveActionId(DEFAULT_KEYMAP, chordSource('Space', { shiftKey: true }))).toBeNull()
  })
})
