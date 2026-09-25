import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { InlineCopyButton } from '@/components/ui/InlineCopyButton'
import { useGuestsStore, type GuestView } from '@/store/guests.store'
import { guestsApi, type GuestState, type ReturnMode } from '@/lib/api'
import type { OutboundMessage } from '@/hooks/useControllerWs'

// ─── Guest calling operator UI (epic open-live#208, studio#138) ─────────────────
//
// First increment of the Studio guest-calling surface, wired to the documented
// backend contract in `Eyevinn/open-live` docs/specs/guest-calling-intercom.md:
//   - Invites:      REST `.../guests/invites` (create / list / revoke) + share link.
//   - Guest list:   REST `GET .../guests` seed + live `GUEST_STATE` WS events; kick
//                   via `DELETE .../guests/:guestId`.
//   - Return mode:  `RETURN_SET` WS command, reflecting `RETURN_STATE` broadcasts.
//   - Talkback:     surfaces the guest's Open Intercom line when present (audio-only,
//                   degrades cleanly when absent) — see follow-up note below.
//
// GREEN-ROOM DECISION (spec "Remaining" open question — Studio multiviewer vs a
// dedicated preview surface): this increment REUSES the existing Studio multiviewer.
// A joined guest is a WHIP source assigned to a mixer input, so it already appears
// in the multiviewer grid and is taken to preview/air with the existing vision-mixer
// controls (SET_PVW / CUT / TAKE). The guest list below makes the pre-air workflow
// legible via the derived state chips (invited → joined → previewing → on-air). A
// dedicated single-guest green-room preview surface is a deliberate follow-up.
//
// FOLLOW-UP (clearly scoped out of this increment): live talkback audio (WHIP/WHEP
// to intercom-manager) and a dedicated green-room preview surface. The endpoints and
// WS events used here must be verified against staging before merge (built strictly
// against the spec; no mocked contracts).

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

interface GuestPanelProps {
  productionId: string
  send: (msg: OutboundMessage) => void
}

export function GuestPanel({ productionId, send }: GuestPanelProps) {
  const invites = useGuestsStore((s) => s.invites)
  const guestsMap = useGuestsStore((s) => s.guests)
  const returnModes = useGuestsStore((s) => s.returnModes)
  const setInvites = useGuestsStore((s) => s.setInvites)
  const addInvite = useGuestsStore((s) => s.addInvite)
  const removeInvite = useGuestsStore((s) => s.removeInvite)
  const setGuests = useGuestsStore((s) => s.setGuests)

  const [label, setLabel] = useState('')
  const [ttlS, setTtlS] = useState<number>(86400)
  const [creating, setCreating] = useState(false)

  const guests = Object.values(guestsMap).sort((a, b) => a.mixerInput.localeCompare(b.mixerInput))

  // Seed invites + guests from REST on mount / production change. The controller
  // WS keeps GUEST_STATE / RETURN_STATE live thereafter (and re-syncs on reconnect).
  useEffect(() => {
    let cancelled = false
    void guestsApi.listInvites(productionId).then((list) => { if (!cancelled) setInvites(list) }).catch(() => {})
    void guestsApi.listGuests(productionId).then((list) => { if (!cancelled) setGuests(list) }).catch(() => {})
    return () => { cancelled = true }
  }, [productionId, setInvites, setGuests])

  async function handleCreate() {
    setCreating(true)
    try {
      const body: { label?: string; expiresInS?: number } = { expiresInS: ttlS }
      const trimmed = label.trim()
      if (trimmed) body.label = trimmed
      const invite = await guestsApi.createInvite(productionId, body)
      addInvite(invite)
      setLabel('')
    } catch {
      // request() surfaces the error toast; leave the form intact for a retry.
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(inviteId: string) {
    // Optimistic removal — revoke is idempotent (404 treated as success).
    removeInvite(inviteId)
    try {
      await guestsApi.revokeInvite(productionId, inviteId)
    } catch {
      // On failure the next list refresh (production change) reconciles.
    }
  }

  async function handleKick(guestId: string) {
    try {
      await guestsApi.kickGuest(productionId, guestId)
      // The backend broadcasts GUEST_STATE 'left', which removes the row.
    } catch {
      // request() surfaces the error toast.
    }
  }

  function handleReturnMode(mixerInput: string, mode: ReturnMode) {
    send({ type: 'RETURN_SET', mixerInput, mode })
  }

  return (
    <div className="flex flex-col gap-3 text-zinc-300">

      {/* ── Invites ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Invites</span>

        {/* Create form */}
        <div className="flex flex-col gap-1.5 border border-zinc-800 bg-zinc-950 px-2.5 py-2">
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
              onClick={() => { void handleCreate() }}
              disabled={creating}
              className={cn(
                'btn-hardware px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest border transition-colors shrink-0',
                creating
                  ? 'bg-zinc-900 text-zinc-700 border-zinc-800 cursor-not-allowed'
                  : 'bg-orange-500 text-black border-orange-400 hover:brightness-110 cursor-pointer',
              )}
            >
              {creating ? 'Creating…' : 'Invite'}
            </button>
          </div>
        </div>

        {/* Invite list */}
        {invites.length === 0 ? (
          <p className="text-[9px] text-zinc-600 px-1">No invites yet.</p>
        ) : (
          invites.map((inv) => (
            <div key={inv.id} className="flex items-center gap-2 border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[10px] font-bold text-zinc-300 truncate">{inv.label?.trim() || 'Guest'}</span>
                <span className="text-[8px] uppercase tracking-widest text-zinc-600">{expiryLabel(inv.expiresAt)}</span>
              </div>
              {/*
                The invite `joinUrl` is the backend join endpoint
                (`POST /api/v1/guests/:inviteId/join`), which authenticates the
                raw invite `token` via an `Authorization: Bearer` header — the
                URL itself does NOT embed the token, and the backend does not
                accept it as a query/path segment (verified against open-live
                `src/routes/guests.ts`). So the copied `joinUrl` alone cannot
                authenticate a join. Until the guest-client link scheme is
                pinned down, expose the token as a separate copyable field
                alongside the link rather than guessing an unsupported URL
                scheme (returned on create only, hence often absent on the
                REST invite list).
              */}
              {inv.joinUrl && (
                <InlineCopyButton label="Link" value={inv.joinUrl} />
              )}
              {inv.token && (
                <InlineCopyButton label="Token" value={inv.token} />
              )}
              <button
                type="button"
                onClick={() => { void handleRevoke(inv.id) }}
                title="Revoke invite"
                aria-label="Revoke invite"
                className="text-zinc-600 hover:text-red-400 transition-colors cursor-pointer text-[13px] leading-none px-1 shrink-0"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* ── Guests ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Guests</span>

        {guests.length === 0 ? (
          <p className="text-[9px] text-zinc-600 px-1">
            No guests connected. Share an invite link; joined guests appear here and in the multiviewer.
          </p>
        ) : (
          guests.map((g) => {
            const badge = STATE_BADGE[g.state]
            const mode = returnModes[g.mixerInput]
            return (
              <div key={g.guestId} className="flex flex-col gap-1.5 border border-zinc-800 bg-zinc-950 px-2.5 py-2">
                {/* Header: name + state + kick */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300 truncate flex-1 min-w-0">
                    {guestName(g)}
                  </span>
                  {g.intercomLine && (
                    <span
                      title={`Talkback line available (${g.intercomLine})`}
                      className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest text-sky-300 border border-sky-800 bg-sky-950/40 px-1.5 py-0.5 rounded shrink-0"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
                      </svg>
                      Talkback
                    </span>
                  )}
                  <Badge variant={badge.variant} label={badge.label} className="shrink-0" />
                  <button
                    type="button"
                    onClick={() => { void handleKick(g.guestId) }}
                    title="Kick guest"
                    aria-label="Kick guest"
                    className="text-zinc-600 hover:text-red-400 transition-colors cursor-pointer text-[13px] leading-none px-1 shrink-0"
                  >
                    ✕
                  </button>
                </div>

                {/* Return-mode control */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-600 shrink-0">Return</span>
                  <div className="flex items-center gap-1">
                    {(['program', 'program-minus'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleReturnMode(g.mixerInput, m)}
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
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
