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
