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

/**
 * A guest that dropped off its mixer input — left voluntarily or was kicked
 * (`GUEST_STATE` with `state: 'left'`, broadcast from open-live `guests.ts`
 * `broadcastGuestState`). The live guest is removed from `guests` on `left`, so
 * this record is retained separately, keyed by `mixerInput`, to drive the
 * controller "guest dropped" warning on that input's PGM/PiP tile until the
 * operator acts (studio#193, split from open-live#491). Warning only — it never
 * triggers an automatic cut.
 */
export interface DroppedGuest {
  mixerInput: string
  /** Last known guest label, for the warning tooltip. */
  label?: string
  /** Epoch ms the drop was observed. */
  at: number
}

interface GuestsState {
  invites: GuestInvite[]
  guests: Record<string, GuestView>
  returnModes: Record<string, ReturnMode>
  /**
   * Inputs whose live guest dropped, keyed by `mixerInput`. Populated by
   * `applyGuestState` on a `left` event and cleared when a guest (re)occupies
   * that input or on production change. The controller only surfaces a warning
   * for an entry here whose input is *currently* live on program / in a PiP
   * (see `src/lib/guest-drop.ts`), so a drop on an idle input stays silent.
   */
  droppedInputs: Record<string, DroppedGuest>
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
  /** Acknowledge/clear the "guest dropped" warning for a single input. */
  clearDroppedInput: (mixerInput: string) => void
  /** Apply a `GUEST_HEALTH` WS event; `null` clears the seat. */
  applyGuestHealth: (mixerInput: string, failure: GuestHealthFailure | null) => void
  clearGuestHealth: () => void
  reset: () => void
}

function inviteLabel(invites: GuestInvite[], inviteId: string | undefined): string | undefined {
  if (!inviteId) return undefined
  return invites.find((i) => i.id === inviteId)?.label?.trim() || undefined
}

/**
 * Fill in the fields a REST `GuestSession` does not carry. The REST seed has no
 * `label`, and it typically lands *after* the WS connect-sync `GUEST_STATE`
 * (which does carry it), so replacing the entry wholesale would wipe the guest
 * name after a Studio reload (studio#221). Keep `label` / `intercomLine` from an
 * existing entry for the same guest, falling back to the invite's label.
 */
function withSeedExtras(
  base: Omit<GuestView, 'label' | 'intercomLine'>,
  g: GuestSession,
  prev: GuestView | undefined,
  invites: GuestInvite[],
): GuestView {
  const label = prev?.label?.trim() || inviteLabel(invites, g.inviteId)
  // REST carries the talkback line as the raw `intercomLineId` doc field (a
  // string); the WS `GUEST_STATE` event calls the same value `intercomLine`.
  // Map it in so the Talkback badge renders from the REST seed too.
  const intercomLine = g.intercomLineId || prev?.intercomLine
  return {
    ...base,
    ...(label ? { label } : {}),
    ...(intercomLine ? { intercomLine } : {}),
  }
}

export const useGuestsStore = create<GuestsState & GuestsActions>()(
  devtools(
    (set) => ({
      invites: [],
      guests: {},
      returnModes: {},
      droppedInputs: {},
      health: {},

      setInvites: (invites) =>
        set((state) => {
          // Backfill the name of any live guest still missing one (e.g. the
          // REST guest seed landed before the invites list and before any
          // GUEST_STATE carrying `label`) — studio#221.
          let guests = state.guests
          for (const g of Object.values(state.guests)) {
            if (g.label?.trim() || !g.inviteId) continue
            const label = inviteLabel(invites, g.inviteId)
            if (!label) continue
            if (guests === state.guests) guests = { ...state.guests }
            guests[g.guestId] = { ...g, label }
          }
          return { invites, guests }
        }),

      addInvite: (invite) =>
        set((state) => ({ invites: [invite, ...state.invites.filter((i) => i.id !== invite.id)] })),

      removeInvite: (inviteId) =>
        set((state) => ({ invites: state.invites.filter((i) => i.id !== inviteId) })),

      setGuests: (guests) =>
        set((state) => {
          const live = guests.filter((g) => g.state !== 'left')
          // A guest present in the REST seed occupies its input, so any stale
          // "guest dropped" warning for that input is cleared.
          const droppedInputs = { ...state.droppedInputs }
          for (const g of live) delete droppedInputs[g.mixerInput]
          return {
          // The REST list returns `left` sessions unfiltered; drop them so a
          // kicked/departed guest does not linger with a live Kick button —
          // matching how the WS connect-sync drops `left` via applyGuestState.
          guests: Object.fromEntries(
            live
              .map((g) => [
                g.id,
                withSeedExtras(
                  {
                    guestId: g.id,
                    mixerInput: g.mixerInput,
                    state: g.state,
                    inviteId: g.inviteId,
                    // The backend always projects `muted` (default false, open-live#382).
                    muted: g.muted,
                  },
                  g,
                  state.guests[g.id],
                  state.invites,
                ),
              ]),
          ),
          droppedInputs,
          }
        }),

      applyGuestState: (guest) =>
        set((state) => {
          const prev = state.guests[guest.guestId]
          if (guest.state === 'left') {
            const next = { ...state.guests }
            delete next[guest.guestId]
            // Record the drop so the controller can warn on that input's PGM/PiP
            // tile while it is live (studio#193). Warning only — no auto-cut.
            return {
              guests: next,
              droppedInputs: {
                ...state.droppedInputs,
                [guest.mixerInput]: {
                  mixerInput: guest.mixerInput,
                  label: guest.label ?? prev?.label,
                  at: Date.now(),
                } satisfies DroppedGuest,
              },
            }
          }
          // A guest (re)occupies this input, so any stale drop warning clears.
          const droppedInputs = { ...state.droppedInputs }
          delete droppedInputs[guest.mixerInput]
          return {
            droppedInputs,
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

      clearDroppedInput: (mixerInput) =>
        set((state) => {
          if (!(mixerInput in state.droppedInputs)) return {}
          const droppedInputs = { ...state.droppedInputs }
          delete droppedInputs[mixerInput]
          return { droppedInputs }
        }),

      applyGuestHealth: (mixerInput, failure) =>
        set((state) => {
          const next = { ...state.health }
          if (failure) next[mixerInput] = failure
          else delete next[mixerInput]
          return { health: next }
        }),

      clearGuestHealth: () => set({ health: {}, droppedInputs: {} }),

      reset: () => set({ invites: [], guests: {}, returnModes: {}, health: {}, droppedInputs: {} }),
    }),
    { name: 'guests', enabled: import.meta.env.DEV },
  ),
)
