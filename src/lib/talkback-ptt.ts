/**
 * Operator talk state machine for guest talkback (studio#237, spec §5.2, OQ1).
 *
 * Push-to-talk (hold) is the default; a latch toggle keeps a guest's talk on.
 * Rules:
 *   - press  → that guest's track is enabled while held
 *   - release / window blur / visibility hidden / pointercancel → a held press ends
 *   - latch  → the track stays enabled after release
 *   - only one guest can be latched; latching another releases the first
 *
 * Pure: the talkback manager maps `isTalking` onto `track.enabled`.
 */

export interface TalkState {
  /** Guest whose Talk button is currently held, if any. */
  held: string | null
  /** The one guest whose talk is latched on, if any. */
  latched: string | null
}

export type TalkAction =
  | { type: 'press'; guestId: string }
  | { type: 'release'; guestId: string }
  /** Window blur, `visibilitychange` → hidden, or `pointercancel`: end any held press. */
  | { type: 'cancel-hold' }
  | { type: 'toggle-latch'; guestId: string }
  /** The guest's talkback closed: drop any hold or latch on it. */
  | { type: 'remove'; guestId: string }

export const INITIAL_TALK_STATE: TalkState = { held: null, latched: null }

export function talkReducer(state: TalkState, action: TalkAction): TalkState {
  switch (action.type) {
    case 'press':
      return state.held === action.guestId ? state : { ...state, held: action.guestId }
    case 'release':
      return state.held === action.guestId ? { ...state, held: null } : state
    case 'cancel-hold':
      return state.held === null ? state : { ...state, held: null }
    case 'toggle-latch':
      return { ...state, latched: state.latched === action.guestId ? null : action.guestId }
    case 'remove':
      if (state.held !== action.guestId && state.latched !== action.guestId) return state
      return {
        held: state.held === action.guestId ? null : state.held,
        latched: state.latched === action.guestId ? null : state.latched,
      }
  }
}

/** Whether the operator's mic should currently reach `guestId`. */
export function isTalking(state: TalkState, guestId: string): boolean {
  return state.held === guestId || state.latched === guestId
}
