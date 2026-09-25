import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { GuestInvite, GuestSession, GuestState, ReturnMode } from '@/lib/api'

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
//
// All three are reset on production change (see production.store setActiveProduction).

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
}

interface GuestsState {
  invites: GuestInvite[]
  guests: Record<string, GuestView>
  returnModes: Record<string, ReturnMode>
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
  reset: () => void
}

export const useGuestsStore = create<GuestsState & GuestsActions>()(
  devtools(
    (set) => ({
      invites: [],
      guests: {},
      returnModes: {},

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
              },
            },
          }
        }),

      applyReturnState: (mixerInput, mode) =>
        set((state) => ({ returnModes: { ...state.returnModes, [mixerInput]: mode } })),

      reset: () => set({ invites: [], guests: {}, returnModes: {} }),
    }),
    { name: 'guests', enabled: import.meta.env.DEV },
  ),
)
