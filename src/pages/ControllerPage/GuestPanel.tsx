import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { InlineCopyButton } from '@/components/ui/InlineCopyButton'
import { MutedMicIcon } from '@/components/ui/MutedMicIcon'
import { useGuestsStore, type GuestView } from '@/store/guests.store'
import { useProductionStore } from '@/store/production.store'
import type { Production } from '@/store/productions.store'
import { ApiError, guestsApi, type GuestState, type ReturnMode } from '@/lib/api'
import type { OutboundMessage } from '@/hooks/useControllerWs'

/** Best-effort human message for a failed create/revoke/kick action. */
function actionErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

// ─── Guest calling operator UI (epic open-live#208, studio#138/#163) ───────────
//
// Slot-first view of the guest-calling feature, wired to the real backend
// contract verified against `Eyevinn/open-live` source (not just the spec):
//   - Slots:     a guest slot is a `ProductionSourceAssignment` carrying
//                `returnFeed` (open-live#381 item 1, declared in Production
//                Options → Guest Slots). Invites/joins target one via
//                `mixerInput`; the backend rejects anything else (400/409).
//   - Invites:   REST `.../guests/invites` (create pinned to a slot / revoke)
//                + ONE guest-page link per invite (`joinUrl` — the token rides
//                the URL fragment, the guest page authenticates the join
//                itself, so no separate token copy affordance is needed).
//   - Guest list: REST `GET .../guests` seed + live `GUEST_STATE` WS broadcasts
//                 (which always carry `muted`, open-live#382) via `kick` to free
//                 a slot.
//   - Return mode: `RETURN_SET` WS command, reflecting `RETURN_STATE` broadcasts.
//   - Muted:     `GUEST_STATE.muted` drives a mic-muted badge per slot,
//                emphasized while the guest is on PVW/PGM so a muted guest is
//                never taken to air unnoticed (studio#163 requirement 5).
//
// A joined guest is a WHIP source assigned to a mixer input, so it already
// appears in the vision-mixer PGM/PVW tiles (TransitionPanel) and is taken to
// preview/air with the existing SET_PVW / CUT / TAKE controls.

/** Badge variant + short label per guest state. */
const STATE_BADGE: Record<GuestState, { variant: 'idle' | 'connected' | 'preview' | 'live' | 'disconnected' | 'error'; label: string }> = {
  invited:    { variant: 'idle',         label: 'INVITED' },
  joined:     { variant: 'connected',    label: 'JOINED' },
  previewing: { variant: 'preview',      label: 'PREVIEW' },
  'on-air':   { variant: 'live',         label: 'ON AIR' },
  left:       { variant: 'disconnected', label: 'LEFT' },
  error:      { variant: 'error',        label: 'ERROR' },
}

/** Best-effort human name for a guest row. */
function guestName(g: GuestView): string {
  return g.label?.trim() || g.mixerInput
}

/** Relative "expires in" / "expired" label for an ISO 8601 timestamp. */
function expiryLabel(iso: string): string {
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const deltaS = Math.round((ms - Date.now()) / 1000)
  if (deltaS <= 0) return 'expired'
  if (deltaS < 3600) return `expires in ${Math.round(deltaS / 60)}m`
  if (deltaS < 86400) return `expires in ${Math.round(deltaS / 3600)}h`
  return `expires in ${Math.round(deltaS / 86400)}d`
}

// TTL choices for the create form (seconds), mirroring the backend default of 1 day.
const TTL_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '1 hour', value: 3600 },
  { label: '4 hours', value: 14400 },
  { label: '1 day', value: 86400 },
  { label: '1 week', value: 604800 },
]

/** Numeric mixer-input index, for sorting guest slots into a stable "Slot N" order. */
function mixerInputIndex(mi: string): number {
  return parseInt(/(\d+)$/.exec(mi)?.[1] ?? '0', 10)
}

interface GuestPanelProps {
  production: Production
  send: (msg: OutboundMessage) => void
}

export function GuestPanel({ production, send }: GuestPanelProps) {
  const productionId = production.id
  const invites = useGuestsStore((s) => s.invites)
  const guestsMap = useGuestsStore((s) => s.guests)
  const returnModes = useGuestsStore((s) => s.returnModes)
  const setInvites = useGuestsStore((s) => s.setInvites)
  const addInvite = useGuestsStore((s) => s.addInvite)
  const removeInvite = useGuestsStore((s) => s.removeInvite)
  const setGuests = useGuestsStore((s) => s.setGuests)
  const { pgmInput, pvwInput } = useProductionStore()

  // Which slot's inline invite form is open, plus its draft fields.
  const [openInviteSlot, setOpenInviteSlot] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [ttlS, setTtlS] = useState<number>(86400)
  const [creating, setCreating] = useState(false)
  // Set from a 503 on either seed call — the backend's message explains *why*
  // (e.g. "Guest calling is disabled — set GUEST_INVITE_SECRET to enable it").
  // Non-null means the feature is gated off, not just "no invites yet".
  const [disabledReason, setDisabledReason] = useState<string | null>(null)
  // Most recent create/revoke/kick failure, shown inline instead of relying
  // solely on the global (non-persistent) toast.
  const [actionError, setActionError] = useState<string | null>(null)

  // Guest slots declared on this production (open-live#381 item 1), ordered
  // into a stable "Slot 1, Slot 2, …" sequence (Production Options allocates
  // them from the top of the mixer-input range down, so the highest index is
  // Slot 1 — sort descending to match).
  const guestSlots = [...production.sources]
    .filter((s) => !!s.returnFeed)
    .sort((a, b) => mixerInputIndex(b.mixerInput) - mixerInputIndex(a.mixerInput))

  // Seed invites + guests from REST on mount / production change. The controller
  // WS keeps GUEST_STATE / RETURN_STATE live thereafter (and re-syncs on reconnect).
  useEffect(() => {
    let cancelled = false
    setDisabledReason(null)
    setActionError(null)
    setOpenInviteSlot(null)

    function handleSeedError(err: unknown) {
      if (cancelled) return
      // A 503 here means guest calling is disabled backend-wide (the same
      // gate covers both endpoints) — surface it as a disabled state, not a
      // transient failure to retry.
      if (err instanceof ApiError && err.status === 503) {
        setDisabledReason(err.message)
      }
    }

    void guestsApi.listInvites(productionId).then((list) => { if (!cancelled) setInvites(list) }).catch(handleSeedError)
    void guestsApi.listGuests(productionId).then((list) => { if (!cancelled) setGuests(list) }).catch(handleSeedError)
    return () => { cancelled = true }
  }, [productionId, setInvites, setGuests])

  function openInvite(mixerInput: string) {
    setOpenInviteSlot(mixerInput)
    setLabel('')
    setTtlS(86400)
    setActionError(null)
  }

  async function handleCreateForSlot(mixerInput: string) {
    setCreating(true)
    setActionError(null)
    try {
      // A slot carries at most one live invite (studio#163 requirement 3) —
      // replace any existing one so an old link for this slot stops working
      // the moment a new invite is issued for it.
      const existing = invites.find((inv) => inv.mixerInput === mixerInput)
      if (existing) {
        await guestsApi.revokeInvite(productionId, existing.id).catch(() => {})
        removeInvite(existing.id)
      }
      const trimmed = label.trim()
      const invite = await guestsApi.createInvite(productionId, {
        mixerInput,
        expiresInS: ttlS,
        ...(trimmed ? { label: trimmed } : {}),
      })
      addInvite(invite)
      setOpenInviteSlot(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setDisabledReason(err.message)
      setActionError(actionErrorMessage(err, 'Failed to create invite.'))
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(inviteId: string) {
    // Optimistic removal — revoke is idempotent (404 treated as success).
    removeInvite(inviteId)
    setActionError(null)
    try {
      await guestsApi.revokeInvite(productionId, inviteId)
    } catch (err) {
      // On failure the next list refresh (production change) reconciles.
      setActionError(actionErrorMessage(err, 'Failed to revoke invite.'))
    }
  }

  async function handleKick(guestId: string) {
    setActionError(null)
    try {
      await guestsApi.kickGuest(productionId, guestId)
      // The backend broadcasts GUEST_STATE 'left', which removes the row.
    } catch (err) {
      setActionError(actionErrorMessage(err, 'Failed to kick guest.'))
    }
  }

  function handleReturnMode(mixerInput: string, mode: ReturnMode) {
    send({ type: 'RETURN_SET', mixerInput, mode })
  }

  return (
    <div className="flex flex-col gap-3 text-zinc-300">

      {/* Disabled-feature notice — a 503 on the seed calls means guest calling
          is gated off backend-wide (e.g. no GUEST_INVITE_SECRET configured),
          not that there are simply no slots/invites yet (PR#157). */}
      {disabledReason && (
        <p className="text-[9px] text-amber-400 border border-amber-900 bg-amber-950/30 px-2 py-1.5 leading-snug">
          {disabledReason}
        </p>
      )}

      {/* Inline create/revoke/kick failure — in addition to the global toast. */}
      {actionError && (
        <p className="text-[9px] text-red-400/90 px-1 leading-snug break-words">{actionError}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Guest Slots</span>

        {guestSlots.length === 0 ? (
          !disabledReason && (
            <p className="text-[9px] text-zinc-600 px-1 leading-snug">
              No guest slots on this production. Add guest slots in Production Options (Sources · Graphics · Guest Slots).
            </p>
          )
        ) : (
          guestSlots.map((slot, i) => {
            const invite = invites.find((inv) => inv.mixerInput === slot.mixerInput)
            const guest = Object.values(guestsMap).find((g) => g.mixerInput === slot.mixerInput)
            const badge = guest ? STATE_BADGE[guest.state] : null
            const mode = guest ? returnModes[guest.mixerInput] : undefined
            const onAirOrPvw = guest ? pgmInput === guest.mixerInput || pvwInput === guest.mixerInput : false

            return (
              <div key={slot.mixerInput} className="flex flex-col gap-1.5 border border-zinc-800 bg-zinc-950 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 shrink-0">Slot {i + 1}</span>

                  {guest ? (
                    <>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300 truncate flex-1 min-w-0">
                        {guestName(guest)}
                      </span>
                      {guest.muted && <MutedMicIcon emphasized={onAirOrPvw} />}
                      {guest.intercomLine && (
                        <span
                          title={`Talkback line available (${guest.intercomLine})`}
                          className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest text-sky-300 border border-sky-800 bg-sky-950/40 px-1.5 py-0.5 rounded shrink-0"
                        >
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
                          </svg>
                          Talkback
                        </span>
                      )}
                      {badge && <Badge variant={badge.variant} label={badge.label} className="shrink-0" />}
                      <button
                        type="button"
                        onClick={() => { void handleKick(guest.guestId) }}
                        title="Remove guest"
                        aria-label="Remove guest"
                        className="text-zinc-600 hover:text-red-400 transition-colors cursor-pointer text-[13px] leading-none px-1 shrink-0"
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] text-zinc-600 italic flex-1 min-w-0">Free</span>
                      {openInviteSlot !== slot.mixerInput && (
                        <button
                          type="button"
                          onClick={() => openInvite(slot.mixerInput)}
                          disabled={disabledReason !== null}
                          className={cn(
                            'btn-hardware px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors shrink-0',
                            disabledReason !== null
                              ? 'bg-zinc-900 text-zinc-700 border-zinc-800 cursor-not-allowed'
                              : 'bg-orange-500 text-black border-orange-400 hover:brightness-110 cursor-pointer',
                          )}
                        >
                          Invite
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Return-mode control (occupied slots only) */}
                {guest && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-600 shrink-0">Return</span>
                    <div className="flex items-center gap-1">
                      {(['program', 'program-minus'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => handleReturnMode(guest.mixerInput, m)}
                          title={m === 'program' ? 'Full program mix (guest hears everything)' : 'Mix-minus (program without the guest’s own channel)'}
                          className={cn(
                            'btn-hardware px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors cursor-pointer',
                            mode === m
                              ? 'bg-orange-500 text-black border-orange-400'
                              : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200 hover:border-zinc-500',
                          )}
                        >
                          {m === 'program' ? 'PGM' : 'PGM-N1'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Invite (free slot only) — either the inline create form, or
                    the single copyable guest-page link for a pending invite. */}
                {!guest && openInviteSlot === slot.mixerInput && (
                  <div className="flex flex-col gap-1.5 border-t border-zinc-800 pt-1.5">
                    <input
                      type="text"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Guest label (optional)"
                      aria-label="Guest label"
                      className="bg-zinc-900 border border-zinc-700 text-[10px] px-2 py-1 focus:outline-none focus:border-orange-500 text-zinc-200 placeholder:text-zinc-600"
                    />
                    <div className="flex items-center gap-1.5">
                      <select
                        value={ttlS}
                        onChange={(e) => setTtlS(parseInt(e.target.value, 10))}
                        aria-label="Invite lifetime"
                        className="flex-1 min-w-0 text-[10px] font-bold uppercase tracking-widest cursor-pointer bg-zinc-900 border border-zinc-700 text-zinc-400 px-1.5 py-1 focus:outline-none focus:border-orange-500"
                      >
                        {TTL_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => { void handleCreateForSlot(slot.mixerInput) }}
                        disabled={creating}
                        className={cn(
                          'btn-hardware px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest border transition-colors shrink-0',
                          creating
                            ? 'bg-zinc-900 text-zinc-700 border-zinc-800 cursor-not-allowed'
                            : 'bg-orange-500 text-black border-orange-400 hover:brightness-110 cursor-pointer',
                        )}
                      >
                        {creating ? 'Creating…' : 'Create'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenInviteSlot(null)}
                        className="text-zinc-600 hover:text-zinc-300 transition-colors cursor-pointer text-[10px] px-1 shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {!guest && !openInviteSlot && invite && (
                  <div className="flex items-center gap-2 border-t border-zinc-800 pt-1.5">
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[10px] font-bold text-zinc-300 truncate">{invite.label?.trim() || 'Guest'}</span>
                      <span className="text-[8px] uppercase tracking-widest text-zinc-600">{expiryLabel(invite.expiresAt)}</span>
                    </div>
                    {/* ONE copy affordance: `joinUrl` is the guest PAGE link (the
                        invite token rides the URL fragment) — the page itself
                        authenticates the join, so no separate token copy is
                        needed (studio#163 requirement 3, replaces PR#152's
                        Link+Token pair). Absent on some list responses (the
                        backend cannot rebuild it after create), so render the
                        affordance only when present. */}
                    {invite.joinUrl && <InlineCopyButton label="Copy link" value={invite.joinUrl} />}
                    <button
                      type="button"
                      onClick={() => { void handleRevoke(invite.id) }}
                      title="Revoke invite"
                      aria-label="Revoke invite"
                      className="text-zinc-600 hover:text-red-400 transition-colors cursor-pointer text-[13px] leading-none px-1 shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
