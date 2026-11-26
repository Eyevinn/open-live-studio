import type { StreamType } from '@/lib/api'

/**
 * True if a guest slot's source is not WHIP, so the guest only receives the
 * return: the slot's encoder (Larix/Moblin on a phone, an aid-station camera)
 * carries their picture and voice. Mirrors the backend's `slotTakesWhip`
 * (open-live#409): the virtual `Whip` source or a catalogue `whip` source takes
 * a browser publish; anything else, including a source missing from the
 * catalogue, is return-only.
 */
export function isReturnOnlySlot(sourceId: string, sources: Array<{ id: string; streamType: StreamType }>): boolean {
  if (sourceId === 'Whip') return false
  return sources.find((s) => s.id === sourceId)?.streamType !== 'whip'
}

/**
 * 1-based "Guest N" number of a guest slot, or `undefined` when `mixerInput` is
 * not one. Slots are numbered from the top of the mixer-input range down, the
 * same order the Guests panel, the vision-mixer tiles and open-live's
 * multiviewer labels use.
 */
export function guestSlotNumber(assignments: Array<{ mixerInput: string; returnFeed?: unknown }>, mixerInput: string): number | undefined {
  const index = (mi: string) => parseInt(/(\d+)$/.exec(mi)?.[1] ?? '0', 10)
  const ordered = assignments
    .filter((a) => !!a.returnFeed)
    .sort((a, b) => index(b.mixerInput) - index(a.mixerInput))
  const at = ordered.findIndex((a) => a.mixerInput === mixerInput)
  return at === -1 ? undefined : at + 1
}

/**
 * Display name of a guest slot's mixer input, or `undefined` when `mixerInput`
 * is not a guest slot (no assignment, or one without `returnFeed`), so the
 * caller falls back to its normal source naming.
 *
 * A joined guest (matched by `mixerInput`) shows their own invite label, the
 * same name the Guests panel shows; a free slot, or a joined guest with no
 * known label, shows "Guest N" (studio#221). Never the raw `Whip` sourceId
 * (studio#171, #212, #262). Shared by the vision-mixer tiles, the PiP editor
 * and the phone tally strip so all three name a guest identically.
 */
export function guestSlotName(
  assignments: Array<{ mixerInput: string; returnFeed?: unknown }>,
  mixerInput: string,
  guests: Iterable<{ mixerInput: string; label?: string }>,
): string | undefined {
  if (!assignments.some((a) => a.mixerInput === mixerInput && !!a.returnFeed)) return undefined
  let label: string | undefined
  for (const g of guests) {
    if (g.mixerInput === mixerInput) {
      label = g.label?.trim()
      break
    }
  }
  return label || `Guest ${guestSlotNumber(assignments, mixerInput) ?? ''}`.trim()
}
