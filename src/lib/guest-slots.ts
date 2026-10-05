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
