import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { GuestInvite, GuestSession, GuestState, ReturnMode } from '@/lib/api'
import type { GuestHealthFailure } from '@/lib/guest-health'

// ─── Guest calling operator state (epic open-live#208, studio#138) ──────────────
//
// Holds the operator-side view of the guest-calling feature for the active
// production:
//   - `invites`     — production-scoped join invites (REST driven).
//   - `guests`      — live per-guest sessions, keyed by guestId. Seeded from the
//                     REST `GET .../guests` list and kept live by the `GUEST_STATE`
//                     WS broadcast (and its connect-time sync).
//   - `returnModes` — current synced return-feed mode per mixer input, from the
//                     `RETURN_STATE` WS broadcast.
//   - `health`      — guest seats whose input has stopped, keyed by mixer input,
//                     from the `GUEST_HEALTH` WS broadcast. A seat is present
//                     only while failed; cleared on deactivation.
//
// All four are reset on production change (see production.store setActiveProduction).

/**
 * Merged live view of a guest: the REST `GuestSession` fields plus the extras the
 * `GUEST_STATE` WS event carries (`label`, `intercomLine`) that the persisted doc
 * does not. Keyed by `guestId` in the store.
 */
export interface GuestView {
  guestId: string
  mixerInput: string
  state: GuestState
  label?: string
  /**
   * Open Intercom talkback line id, when one is provisioned. The backend emits
   * this as a plain string: the `GUEST_STATE` WS event carries it as
   * `intercomLine` and the REST `GET .../guests` list carries it as the raw
   * `intercomLineId` doc field (see `setGuests`). Absent when talkback is not
   * configured.
   */
  intercomLine?: string
  inviteId?: string
  /**
   * Mic-mute state reported by the guest page (open-live#382, issue #382),
   * carried on every `GUEST_STATE` broadcast and the REST `GET .../guests`
   * seed. Drives the muted-mic indicator in the Guests panel and on the
   * guest's vision-mixer tile (studio#163).
   */
  muted: boolean
}

interface GuestsState {
  invites: GuestInvite[]
  guests: Record<string, GuestView>
  returnModes: Record<string, ReturnMode>
  health: Record<string, GuestHealthFailure>
}

interface GuestsActions {
  setInvites: (invites: GuestInvite[]) => void
  addInvite: (invite: GuestInvite) => void
  removeInvite: (inviteId: string) => void
  /** Seed the guest map from a REST `GET .../guests` list. */
  setGuests: (guests: GuestSession[]) => void
  /** Apply a `GUEST_STATE` WS event. `left` removes the guest from the map. */
  applyGuestState: (guest: GuestView) => void
  /** Apply a `RETURN_STATE` WS event (or crew `RETURN_SET` echo). */
  applyReturnState: (mixerInput: string, mode: ReturnMode) => void
  /** Apply a `GUEST_HEALTH` WS event; `null` clears the seat. */
  applyGuestHealth: (mixerInput: string, failure: GuestHealthFailure | null) => void
  clearGuestHealth: () => void
  reset: () => void
}

export const useGuestsStore = create<GuestsState & GuestsActions>()(
  devtools(
    (set) => ({
      invites: [],
      guests: {},
      returnModes: {},
      health: {},

      setInvites: (invites) => set({ invites }),

      addInvite: (invite) =>
        set((state) => ({ invites: [invite, ...state.invites.filter((i) => i.id !== invite.id)] })),

      removeInvite: (inviteId) =>
        set((state) => ({ invites: state.invites.filter((i) => i.id !== inviteId) })),

      setGuests: (guests) =>
        set(() => ({
          // The REST list returns `left` sessions unfiltered; drop them so a
          // kicked/departed guest does not linger with a live Kick button —
          // matching how the WS connect-sync drops `left` via applyGuestState.
          guests: Object.fromEntries(
            guests
              .filter((g) => g.state !== 'left')
              .map((g) => [
                g.id,
                {
                  guestId: g.id,
                  mixerInput: g.mixerInput,
                  state: g.state,
                  inviteId: g.inviteId,
                  // The backend always projects `muted` (default false, open-live#382).
                  muted: g.muted,
                  // REST carries the talkback line as the raw `intercomLineId`
                  // doc field (a string); the WS `GUEST_STATE` event calls the
                  // same value `intercomLine`. Map it in so the Talkback badge
                  // renders from the REST seed too.
                  ...(g.intercomLineId ? { intercomLine: g.intercomLineId } : {}),
                } satisfies GuestView,
              ]),
          ),
        })),

      applyGuestState: (guest) =>
        set((state) => {
          if (guest.state === 'left') {
            const next = { ...state.guests }
            delete next[guest.guestId]
            return { guests: next }
          }
          const prev = state.guests[guest.guestId]
          return {
            guests: {
              ...state.guests,
              [guest.guestId]: {
                ...prev,
                ...guest,
                // Preserve prior label/intercomLine when the event omits them.
                label: guest.label ?? prev?.label,
                intercomLine: guest.intercomLine ?? prev?.intercomLine,
                inviteId: guest.inviteId ?? prev?.inviteId,
                // The backend always carries `muted` on GUEST_STATE, but fall
                // back to the prior known value defensively (e.g. a malformed
                // event), then false — never undefined.
                muted: guest.muted ?? prev?.muted ?? false,
              },
            },
          }
        }),

      applyReturnState: (mixerInput, mode) =>
        set((state) => ({ returnModes: { ...state.returnModes, [mixerInput]: mode } })),

      applyGuestHealth: (mixerInput, failure) =>
        set((state) => {
          const next = { ...state.health }
          if (failure) next[mixerInput] = failure
          else delete next[mixerInput]
          return { health: next }
        }),

      clearGuestHealth: () => set({ health: {} }),

      reset: () => set({ invites: [], guests: {}, returnModes: {}, health: {} }),
    }),
    { name: 'guests', enabled: import.meta.env.DEV },
  ),
)
