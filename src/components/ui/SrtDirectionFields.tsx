import { useId } from 'react'
import { useServerInfo } from '@/hooks/useServerInfo'
import type { SrtRelayEndpoint } from '@/lib/api'
import { DEFAULT_RELAY, describeSpans, freePortsInSpans, listenerPort, portInSpans, srtOffer, type PortSpan, type SrtDirection, type SrtOffer } from '@/lib/srt'
import { useOutputsStore } from '@/store/outputs.store'
import { useSourcesStore } from '@/store/sources.store'

export const inputCls = 'w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30'
export const labelCls = 'text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1'

/**
 * How a listener gets its port on this backend. `auto`: the backend holds ports
 * on the shared Strom and assigns a free one on save. `pending`: it is still
 * waiting for them, so nothing can be saved yet. `spans`: no reservation, but
 * Strom reports the ports it is set up for (server-info `srt.ports`, its
 * STROM_PORTS); the operator picks one, `suggested` (the lowest one no listed
 * source or output listens on) when the field is left blank, and a port outside
 * them is allowed with a warning. `manual`: an older backend, or one whose Strom
 * names no ports, where the operator names the port.
 */
export type ListenerPortMode =
  | { kind: 'loading' }
  | { kind: 'auto'; ports: number[] }
  | { kind: 'pending' }
  | { kind: 'spans'; spans: PortSpan[]; suggested: number | null; free: number[] }
  | { kind: 'manual' }

/** How many free ports the `spans` picker lists. */
const OFFERED_PORTS = 20

export function useListenerPortMode(): ListenerPortMode {
  const { info, loaded } = useServerInfo()
  const sources = useSourcesStore((s) => s.sources)
  const outputs = useOutputsStore((s) => s.outputs)
  if (!loaded) return { kind: 'loading' }
  if (info?.srtPortState === 'pending') return { kind: 'pending' }
  if (info?.srtPortState === 'reserved' && info.srtPorts && info.srtPorts.length > 0) {
    return { kind: 'auto', ports: info.srtPorts }
  }
  const spans = info?.srt?.ports
  if (spans && spans.length > 0) {
    const used = [...sources.map((s) => s.address), ...outputs.map((o) => o.url)]
      .map((a) => (a ? listenerPort(a) : null))
      .filter((p): p is number => p !== null)
    const free = freePortsInSpans(spans, used, OFFERED_PORTS)
    return { kind: 'spans', spans, suggested: free[0] ?? null, free }
  }
  return { kind: 'manual' }
}

/**
 * How a set of ports reads to an operator: runs where they are consecutive,
 * individual numbers where they are not. Strom prefers contiguous blocks, so
 * this is usually one range — but it cannot be assumed, and a list of eleven
 * numbers in a form label is worse than `47100–47109, 47250`.
 */
export function describePorts(ports: number[]): string {
  const sorted = [...ports].sort((a, b) => a - b)
  const runs: Array<[number, number]> = []
  for (const p of sorted) {
    const last = runs[runs.length - 1]
    if (last && last[1] + 1 === p) last[1] = p
    else runs.push([p, p])
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}\u2013${b}`)).join(', ')
}

/** The port to put in a listener address, or null when none can be chosen yet. */
export function listenerPortFor(mode: ListenerPortMode, manualPort: string, keep?: number | null): number | null {
  if (keep) return keep
  if (mode.kind === 'auto') return 0
  if (mode.kind === 'spans' && !manualPort.trim()) return mode.suggested
  if (mode.kind === 'manual' || mode.kind === 'spans') return parsePort(manualPort)
  return null
}

function parsePort(value: string): number | null {
  const p = parseInt(value, 10)
  return Number.isInteger(p) && p > 0 && p <= 65535 ? p : null
}

/** The inline warning for a typed port outside Strom's ports, or null. */
export function portOutsideSpansWarning(mode: ListenerPortMode, manualPort: string): string | null {
  if (mode.kind !== 'spans') return null
  const p = parsePort(manualPort)
  if (p === null || portInSpans(p, mode.spans)) return null
  return `Port ${p} is outside the ports Strom is set up for (${describeSpans(mode.spans)}), so senders may not reach it. It is saved anyway.`
}

/** Whether Save is possible in listener mode right now. */
export function listenerReady(mode: ListenerPortMode, manualPort: string, keep?: number | null): boolean {
  return listenerPortFor(mode, manualPort, keep) !== null
}

/**
 * What the SRT direction pickers offer on this backend (server-info `srt`, see
 * `srtOffer`). An older backend without `srt`, or one still loading, offers
 * every mode and no relay.
 */
export function useSrtOffer(): SrtOffer {
  const { info } = useServerInfo()
  return srtOffer(info?.srt)
}

export const RELAY_LABEL = 'Via relay (one public port)'

/**
 * The direction choice. `relayLabel` adds a third choice, "via relay"; pass it
 * only when Strom has a relay, or when the document already uses it.
 * `listenerDisabled` greys Listener out (it cannot work on this Strom) and
 * `note` explains why, or that Strom did not answer the last check.
 */
export function DirectionToggle({
  value, onChange, listenerLabel, callerLabel, relayLabel, listenerDisabled = false, note,
}: {
  value: SrtDirection
  onChange: (d: SrtDirection) => void
  listenerLabel: string
  callerLabel: string
  relayLabel?: string
  listenerDisabled?: boolean
  note?: SrtOffer['note']
}) {
  const cls = (active: boolean) =>
    `py-2 rounded text-sm border transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[var(--color-text-muted)] ${
      active
        ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
        : 'bg-[var(--color-surface-2)] border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-orange-500'
    }`
  return (
    <div>
      <label className={labelCls}>Direction</label>
      <div className={`grid gap-2 ${relayLabel ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <button
          type="button"
          className={cls(value === 'listener')}
          onClick={() => onChange('listener')}
          disabled={listenerDisabled}
          title={listenerDisabled && note ? note.text : undefined}
        >
          {listenerLabel}
        </button>
        <button type="button" className={cls(value === 'caller')} onClick={() => onChange('caller')}>{callerLabel}</button>
        {relayLabel && (
          <button type="button" className={cls(value === 'relay')} onClick={() => onChange('relay')}>{relayLabel}</button>
        )}
      </div>
      {note && (
        <p className={`text-xs mt-1 ${note.kind === 'blocked' ? 'text-amber-400' : 'text-[--color-text-muted] opacity-70'}`}>
          {note.text}
        </p>
      )}
    </div>
  )
}

/** `connect.warning` of a stored source or output, as an amber line; nothing without one. */
export function SrtWarning({ text }: { text: string | null }) {
  return text ? <p role="note" className="text-xs text-amber-400">{text}</p> : null
}

/**
 * The explicit "Remove passphrase" action for an SRT address that has one. An
 * empty passphrase field means "keep", so removal needs its own control.
 */
export function RemovePassphraseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs text-[--color-text-muted] hover:text-orange-500 underline mt-1">
      Remove passphrase
    </button>
  )
}

/**
 * The fields of a listener: how the port is chosen, and an optional passphrase.
 * `keepPort` is the port an existing document already holds; it is kept as is.
 * When a passphrase is stored and `onRemovePassphrase` is given, the operator can
 * mark it for removal; the field is then disabled until the removal is undone.
 */
export function ListenerFields({
  mode, manualPort, onManualPort, passphrase, onPassphrase, keepPort, hasPassphrase, passphraseError,
  removePassphrase = false, onRemovePassphrase,
}: {
  mode: ListenerPortMode
  manualPort: string
  onManualPort: (v: string) => void
  passphrase: string
  onPassphrase: (v: string) => void
  keepPort?: number | null
  /** Whether a passphrase is stored that a blank field keeps. */
  hasPassphrase?: boolean
  removePassphrase?: boolean
  onRemovePassphrase?: (remove: boolean) => void
  passphraseError?: string | null
}) {
  const portListId = useId()
  const outside = portOutsideSpansWarning(mode, manualPort)
  return (
    <>
      <div>
        <label className={labelCls}>Port on the Strom server</label>
        {keepPort ? (
          <p className="text-sm text-[--color-text-primary] font-mono">{keepPort}</p>
        ) : mode.kind === 'loading' ? (
          <p className="text-xs text-[--color-text-muted]">Checking how ports are assigned…</p>
        ) : mode.kind === 'auto' ? (
          <p className="text-xs text-[--color-text-muted]">
            Assigned on save from this instance&apos;s ports {describePorts(mode.ports)}.
          </p>
        ) : mode.kind === 'pending' ? (
          <p className="text-xs text-amber-400">
            This instance is still waiting for its port range from Strom. Try again in a minute.
          </p>
        ) : mode.kind === 'spans' ? (
          <>
            <input
              type="number"
              min={1}
              max={65535}
              value={manualPort}
              placeholder={mode.suggested !== null ? String(mode.suggested) : 'e.g. 9000'}
              list={portListId}
              onChange={(e) => onManualPort(e.target.value)}
              className={inputCls}
            />
            <datalist id={portListId}>
              {mode.free.map((p) => <option key={p} value={p} />)}
            </datalist>
            <p className="text-xs text-[--color-text-muted] mt-1">
              Strom is set up for ports {describeSpans(mode.spans)}.{' '}
              {mode.suggested !== null
                ? `Leave blank to use ${mode.suggested}, the lowest one no listed source or output uses.`
                : 'Every one of them is in use by a listed source or output; enter a port.'}
            </p>
            {outside && <p role="note" className="text-xs text-amber-400 mt-1">{outside}</p>}
          </>
        ) : (
          <>
            <input
              type="number"
              min={1}
              max={65535}
              value={manualPort}
              placeholder="e.g. 9000"
              onChange={(e) => onManualPort(e.target.value)}
              className={inputCls}
            />
            <p className="text-xs text-[--color-text-muted] mt-1">
              This instance has no managed port range, so pick a UDP port that is open on the Strom server and not in use.
            </p>
          </>
        )}
      </div>
      <div>
        <label className={labelCls}>
          Passphrase <span className="normal-case opacity-60">(optional, 10–80 bytes, å counts as 2)</span>
        </label>
        <input
          type="text"
          value={removePassphrase ? '' : passphrase}
          placeholder={removePassphrase ? 'Removed on save' : hasPassphrase ? 'Set — leave blank to keep' : 'None'}
          disabled={removePassphrase}
          onChange={(e) => onPassphrase(e.target.value)}
          className={`${inputCls} disabled:opacity-50`}
        />
        {hasPassphrase && onRemovePassphrase && (
          removePassphrase ? (
            <p className="text-xs text-amber-400 mt-1">
              The passphrase will be removed on save.{' '}
              <button type="button" onClick={() => onRemovePassphrase(false)} className="underline hover:text-orange-500">
                Undo
              </button>
            </p>
          ) : (
            <RemovePassphraseButton onClick={() => onRemovePassphrase(true)} />
          )
        )}
        {passphraseError && <p className="text-xs text-red-400 mt-1">{passphraseError}</p>}
      </div>
    </>
  )
}

/**
 * The fields of a relay address: which relay (only when there is a choice) and
 * a passphrase. The stream ID is generated by the backend on save and kept from
 * then on. `who` names the outside party ("The sender", "Viewers"); `dialIn` is
 * the address it dials, once known.
 */
export function RelayFields({
  passphrase, onPassphrase, hasPassphrase, who, dialIn, dialInMissing, stored, passphraseError,
  removePassphrase = false, onRemovePassphrase,
  relays = [], showPicker = false, relay = DEFAULT_RELAY, onRelay, storedRelay,
}: {
  /** The relays Strom reports (server-info `srt.relays`, `default` first). */
  relays?: SrtRelayEndpoint[]
  /** Whether to show the relay picker (`SrtOffer.relayPicker`, or a stored non-default relay). */
  showPicker?: boolean
  /** The relay chosen (see `chosenRelay`). */
  relay?: string
  onRelay?: (relay: string) => void
  /** The relay the saved document uses, when it is a relay address already. */
  storedRelay?: string | null
  passphrase: string
  onPassphrase: (v: string) => void
  /** Whether a relay passphrase is stored that a blank field keeps. */
  hasPassphrase?: boolean
  /** As on ListenerFields: mark a stored passphrase for removal on save. */
  removePassphrase?: boolean
  onRemovePassphrase?: (remove: boolean) => void
  who: string
  /** The relay dial-in address of a saved document (backend `connect.uri`). */
  dialIn?: string | null
  /** Why `dialIn` is unknown (see `dialInUnknownReason`). */
  dialInMissing?: string
  /** Whether the document is already saved as a relay address. */
  stored?: boolean
  passphraseError?: string | null
}) {
  // A stored relay Strom no longer reports stays selectable, so the form shows
  // what the document holds.
  const options = storedRelay && !relays.some((r) => r.name === storedRelay)
    ? [...relays, { name: storedRelay, public: '' }]
    : relays
  const switched = !!stored && !!storedRelay && relay !== storedRelay
  // A blank field on a relay switch keeps the stored passphrase: the relay
  // never sees it, so the operator need not type it again.
  const keepsPassphrase = !!hasPassphrase && !removePassphrase && !passphrase.trim()
  const target = relays.find((r) => r.name === relay)
  // "The sender dials", "Viewers dial".
  const dials = who.endsWith('s') ? 'dial' : 'dials'
  return (
    <>
      {showPicker && (
        <div>
          <label className={labelCls} htmlFor="srt-relay-picker">Relay</label>
          <select
            id="srt-relay-picker"
            value={relay}
            onChange={(e) => onRelay?.(e.target.value)}
            className={inputCls}
          >
            {options.map((r) => (
              <option key={r.name} value={r.name}>
                {r.public ? `${r.name} (${r.public})` : `${r.name} (not reported by Strom)`}
              </option>
            ))}
          </select>
          {switched && (
            <p className="text-xs text-amber-400 mt-1">
              Moves to the {relay} relay on save; the stream ID {keepsPassphrase ? 'and the passphrase stay' : 'stays'} the same.
              {target ? ` ${who} then ${dials} ${target.public} instead.` : ''}
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-[--color-text-muted]">
        Strom and {who.toLowerCase()} both connect out to the SRT relay&apos;s single public port, and the
        relay pairs them by stream ID. {stored ? 'The stream ID stays the same when you save.' : 'The stream ID is generated on save and never changes.'}
      </p>
      <div>
        <label className={labelCls}>
          Passphrase <span className="normal-case opacity-60">(recommended, 10–80 bytes, å counts as 2)</span>
        </label>
        <input
          type="text"
          value={removePassphrase ? '' : passphrase}
          placeholder={removePassphrase ? 'Removed on save' : hasPassphrase ? 'Set — leave blank to keep' : 'None'}
          disabled={removePassphrase}
          onChange={(e) => onPassphrase(e.target.value)}
          className={`${inputCls} disabled:opacity-50`}
        />
        {hasPassphrase && onRemovePassphrase && (
          removePassphrase ? (
            <p className="text-xs text-amber-400 mt-1">
              The passphrase will be removed on save.{' '}
              <button type="button" onClick={() => onRemovePassphrase(false)} className="underline hover:text-orange-500">
                Undo
              </button>
            </p>
          ) : (
            <RemovePassphraseButton onClick={() => onRemovePassphrase(true)} />
          )
        )}
        {passphraseError && <p className="text-xs text-red-400 mt-1">{passphraseError}</p>}
        {(removePassphrase || (!hasPassphrase && !passphrase.trim())) && (
          <p className="text-xs text-amber-400 mt-1">
            The relay port is public: anyone who learns the stream ID can connect. Set a passphrase.
          </p>
        )}
      </div>
      {stored && !switched && (
        <p className="text-xs text-[--color-text-muted] font-mono break-all">
          {dialIn
            ? `${who} ${dials} ${dialIn}${hasPassphrase && !removePassphrase ? ' with the passphrase' : ''}`
            : `The relay dial-in address is not known: ${dialInMissing ?? 'relay address not known'}.`}
        </p>
      )}
    </>
  )
}
