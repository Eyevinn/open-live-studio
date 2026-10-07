/**
 * Guest-seat health from the controller WS `GUEST_HEALTH` event (open-live,
 * relaying Strom's block health scan). Strom marks a guest's input block failed
 * when it stops passing data while the pipeline keeps running, e.g. the guest's
 * browser stops sending audio. Nothing else in the studio shows that.
 *
 * Shape: { mixerInput, blockId, status: 'ok' | 'failed', detail?, causes? }.
 * `causes` is Strom's optional list of structured causes, tagged by `kind`;
 * only `whip_medium` items ({ kind, slot, medium, fault }) are read, others are
 * skipped. While a seat stays failed Strom re-sends it when `causes` changes.
 */

export type GuestMedium = 'audio' | 'video'

/** A guest seat whose input has stopped. Absent from the store while ok. */
export interface GuestHealthFailure {
  /** Strom's human-readable detail, for a tooltip. */
  detail?: string
  /** Media Strom says stopped; absent when Strom gave no structured cause. */
  media?: GuestMedium[]
}

export interface GuestHealthEvent {
  mixerInput: string
  /** `null` when the seat is healthy again. */
  failure: GuestHealthFailure | null
}

function causeMedia(causes: unknown): GuestMedium[] {
  if (!Array.isArray(causes)) return []
  const media = new Set<GuestMedium>()
  for (const cause of causes) {
    if (cause === null || typeof cause !== 'object') continue
    const { kind, medium } = cause as Record<string, unknown>
    if (kind === 'whip_medium' && (medium === 'audio' || medium === 'video')) media.add(medium)
  }
  return (['audio', 'video'] as const).filter((m) => media.has(m))
}

/** Parse a `GUEST_HEALTH` frame, or `null` when it is malformed. */
export function parseGuestHealth(msg: Record<string, unknown>): GuestHealthEvent | null {
  const mixerInput = msg['mixerInput']
  const status = msg['status']
  if (typeof mixerInput !== 'string' || (status !== 'ok' && status !== 'failed')) return null
  if (status === 'ok') return { mixerInput, failure: null }
  const media = causeMedia(msg['causes'])
  return {
    mixerInput,
    failure: {
      ...(typeof msg['detail'] === 'string' ? { detail: msg['detail'] } : {}),
      ...(media.length > 0 ? { media } : {}),
    },
  }
}

/**
 * Short operator-facing problem text: "no audio", "no video" or "no audio or
 * video" when Strom names the media, otherwise "input stopped" (the block
 * stopped passing data).
 */
export function guestHealthProblem(failure: GuestHealthFailure): string {
  const media = failure.media ?? []
  if (media.length === 0) return 'input stopped'
  return `no ${media.join(' or ')}`
}
