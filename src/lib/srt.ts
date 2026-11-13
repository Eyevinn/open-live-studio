/**
 * The three shapes an SRT address takes in Open Live, and how to move between them.
 *
 * A listener address is hostless: `srt://:PORT?mode=listener`. Strom binds PORT on
 * the shared server and waits for a sender, so the port has to come from this
 * instance's range and be free; port 0 asks the backend to pick one. A caller
 * address names the far end, `srt://host:PORT?mode=caller`, and binds nothing here.
 * A relay address, `srt+relay://<id>[@<relay>]`, is a session on one of the SRT
 * relays Strom knows: one public UDP port where Strom and the outside party both
 * call in with the same stream ID. Without `@` the relay is `default`, and the
 * studio writes the default relay without `@`. `srt+relay://auto[@<relay>]` asks
 * the backend to generate the ID; it is kept from then on, also when an edit
 * sends `auto` again. On an edit, `auto` without `@` also keeps the stored relay,
 * `auto@<relay>` moves the stream to that relay (keeping the ID), and
 * `auto@default` moves it back to the default relay.
 */

import type { ApiError, SrtCapabilities, SrtConnect, SrtRelayEndpoint, SrtRelayErrorBody } from './api'

export type SrtDirection = 'listener' | 'caller' | 'relay'

/** Whether the address is an SRT relay address (`srt+relay://…`). */
export function isRelayAddress(address: string | undefined | null): boolean {
  return !!address && /^srt\+relay:\/\//i.test(address.trim())
}

/** The relay an address without `@<relay>` uses. */
export const DEFAULT_RELAY = 'default'

/** A relay name as Strom and the backend accept it. */
export const RELAY_NAME_RE = /^[a-z0-9-]{1,32}$/

const RELAY_ADDRESS_RE = /^srt\+relay:\/\/([A-Za-z0-9_-]{1,64})(?:@([a-z0-9-]{1,32}))?(?:[?#]|$)/i

/** The stream ID of a relay address, or null. */
export function relayIdOf(address: string): string | null {
  const m = RELAY_ADDRESS_RE.exec(address.trim())
  return m ? (m[1] ?? null) : null
}

/**
 * The relay a relay address uses: its `@<relay>`, or `default` without one.
 * Null when the address is not a (well-formed) relay address.
 */
export function relayNameOf(address: string): string | null {
  const m = RELAY_ADDRESS_RE.exec(address.trim())
  return m ? (m[2] ?? DEFAULT_RELAY) : null
}

/**
 * A passphrase as a URL query value. encodeURIComponent leaves `! * ' ( ) ~`
 * as they are, but the backend accepts only `[A-Za-z0-9._-=&%+]` in an SRT
 * query, so those are percent-encoded too. Strom decodes the value.
 */
export function encodePassphrase(passphrase: string): string {
  return encodeURIComponent(passphrase).replace(/[!*'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** `srt+relay://auto`, with `@<at>` when given, and the passphrase when given. */
function autoRelayAddress(passphrase: string | undefined, at: string | undefined): string {
  const p = passphrase?.trim()
  return `srt+relay://auto${at ? `@${at}` : ''}${p ? `?passphrase=${encodePassphrase(p)}` : ''}`
}

/**
 * A relay address for a new document on `relay` (default: the default relay,
 * written without `@`). The backend generates the stream ID for `auto`.
 */
export function buildRelayAddress(passphrase?: string, relay: string = DEFAULT_RELAY): string {
  return autoRelayAddress(passphrase, relay === DEFAULT_RELAY ? undefined : relay)
}

/** Which way a stored SRT address points. Hostless means Strom listens. */
export function srtDirection(address: string): SrtDirection {
  const a = address.trim()
  if (isRelayAddress(a)) return 'relay'
  if (!/^srt:\/\/:\d+/i.test(a)) return 'caller'
  return /[?&]mode=(caller|rendezvous)\b/i.test(a) ? 'caller' : 'listener'
}

/** The port of a hostless listener address, or null (port 0 counts as null). */
export function listenerPort(address: string): number | null {
  const m = /^srt:\/\/:(\d{1,5})(?:[?#]|$)/i.exec(address.trim())
  if (!m) return null
  const port = Number(m[1])
  return port > 0 && port <= 65535 ? port : null
}

/** The passphrase carried in the address, masked or not, or null. */
export function passphraseOf(address: string): string | null {
  const m = /[?&]passphrase=([^&#]*)/i.exec(address)
  return m ? decodeURIComponent(m[1] ?? '') : null
}

/** A listener address for Strom to bind. Port 0 lets the backend choose. */
export function buildListenerAddress(port: number, passphrase?: string): string {
  const p = passphrase?.trim()
  return `srt://:${port}?mode=listener${p ? `&passphrase=${encodePassphrase(p)}` : ''}`
}

/** The address without its passphrase parameter. */
export function stripPassphrase(address: string): string {
  return address.replace(/([?&])passphrase=[^&#]*(&?)/i, (_m, sep: string, amp: string) => (amp ? sep : '')).replace(/\?$/, '')
}

/**
 * The address a remote party dials to reach a listener on our Strom: the listener
 * form with the Strom host filled in and the mode flipped. Used for the ingest
 * address of a listener source and the viewer address of a listener output. The
 * backend masks passphrases, so the dialled address is given without one; the
 * caller says separately that a passphrase is required.
 */
export function toCallerUrl(address: string, stromHost?: string): string {
  let result = stripPassphrase(address).replace(/mode=listener/i, 'mode=caller')
  if (stromHost && /^srt:\/\/:/.test(result)) {
    result = result.replace(/^srt:\/\/:/, `srt://${stromHost}:`)
  }
  return result
}

/** A caller address must name the far end: a host and a port. */
export function isCallerAddress(address: string): boolean {
  return /^srt:\/\/(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):\d{1,5}(?:[?#]|$)/.test(address.trim())
}

/** What the backend returns in place of a stored passphrase (`passphrase=***`). */
export const MASKED_PASSPHRASE = '***'

/** Whether the address still carries the backend's masked passphrase. */
export function hasMaskedPassphrase(address: string): boolean {
  return passphraseOf(address) === MASKED_PASSPHRASE
}

/**
 * The listener address to PATCH when an edit is saved, or undefined to leave the
 * stored one alone. The backend replaces a sent address in full and keeps the
 * stored one when none is sent, so:
 * - `removePassphrase` sends the address without a passphrase, which removes it;
 * - a typed passphrase, or a switch from caller to listener, sends the new address;
 * - otherwise (an empty field) nothing is sent and the stored passphrase is kept.
 *   Sending the address back would write the masked `***` over the real value.
 */
export function listenerEditAddress(edit: {
  stored: string
  port: number
  passphrase: string
  removePassphrase: boolean
}): string | undefined {
  if (edit.removePassphrase) return buildListenerAddress(edit.port)
  const switched = srtDirection(edit.stored) !== 'listener'
  if (switched || edit.passphrase.trim()) return buildListenerAddress(edit.port, edit.passphrase)
  return undefined
}

/**
 * Why an edited caller address cannot be saved as is, or null. The field starts
 * with the stored address, whose passphrase the backend masks. If the operator
 * changes something else and leaves `passphrase=***` in place, saving would set
 * the passphrase to the literal `***`. The unchanged address is fine: it is not sent.
 */
export function maskedPassphraseError(address: string, stored: string): string | null {
  if (address === stored || !hasMaskedPassphrase(address)) return null
  return 'The passphrase is hidden as ***. Type the passphrase again, or use "Remove passphrase".'
}

/**
 * The address the outside party dials for a stored SRT address, or null when
 * there is none to show. The backend's `connect` decides for listener and relay
 * addresses alike (it applies SRT_PUBLIC_HOST and knows the relay's public
 * address), so Studio and backend never compute the public address two ways.
 * A caller address points elsewhere, so nobody dials us. Never carries the
 * passphrase.
 *
 * A listener on a private or localhost Strom gets `connect.uri: null` (no
 * public address), but it can still be dialled on that network, so the Strom
 * host is used with the mode flipped; `dialInIsLocalOnly` tells the two apart.
 * The same fallback covers an older backend that sends no `connect`. A relay
 * address with `uri: null` has no fallback: its public address is unknown.
 */
export function dialInAddress(address: string, connect: SrtConnect | undefined, stromHost?: string): string | null {
  const direction = srtDirection(address)
  if (direction === 'caller') return null
  if (connect?.uri) return connect.uri
  if (direction !== 'listener') return null
  const host = connect?.host ?? stromHost
  return host ? toCallerUrl(address, host) : null
}

/**
 * Whether `dialInAddress` gave a listener the Strom host because the backend
 * has no public address for it (a private or localhost Strom): dialable only
 * from that network.
 */
export function dialInIsLocalOnly(address: string, connect: SrtConnect | undefined): boolean {
  return !!connect && !connect.uri && srtDirection(address) === 'listener'
}

/**
 * Why the backend could not give a dial-in address, in an operator's words.
 * `relays` (server-info `srt.relays`) names the configured relays for
 * `srt-relay-unknown`.
 */
export function dialInUnknownReason(connect: SrtConnect | undefined, relays?: SrtRelayEndpoint[]): string {
  switch (connect?.reason) {
    case 'srt-relay-not-configured':
      return 'Strom reports no SRT relay'
    case 'srt-relay-unknown': {
      const names = relays?.map((r) => r.name) ?? []
      return `Strom has no SRT relay named "${connect.relay ?? DEFAULT_RELAY}"${names.length ? ` (configured: ${names.join(', ')})` : ''}; edit it and pick another relay`
    }
    case 'srt-relay-unreachable':
      return 'relay status unavailable, Strom is not answering'
    case 'srt-host-not-configured':
    case 'srt-host-not-loopback-reachable':
    case 'strom-url-not-parseable':
      return 'public SRT host not known (set SRT_PUBLIC_HOST on the backend)'
    default:
      return connect?.source === 'srt-relay' || !connect ? 'relay address not known' : 'dial-in address not known'
  }
}

/**
 * The one-line description of a stored SRT address in a source or output row:
 * who dials what (e.g. `sender dials srt://… with the passphrase`), or, when
 * the dial-in address is unknown, why. `dials` is the subject and verb
 * ("sender dials", "viewers dial"). A caller address is shown as stored.
 */
export function srtRowLabel(address: string, connect: SrtConnect | undefined, stromHost: string | undefined, dials: string, relays?: SrtRelayEndpoint[]): string {
  const direction = srtDirection(address)
  const dialIn = dialInAddress(address, connect, stromHost)
  const withPassphrase = passphraseOf(address) !== null ? ' with the passphrase' : ''
  if (dialIn) {
    const localOnly = dialInIsLocalOnly(address, connect) ? ' · local network only (set SRT_PUBLIC_HOST on the backend for a public address)' : ''
    return `${dials} ${dialIn}${withPassphrase}${localOnly}`
  }
  if (direction === 'relay') {
    const relay = relayNameOf(address)
    const named = relay && relay !== DEFAULT_RELAY ? ` ${relay}` : ''
    return `via relay${named} · stream ID ${relayIdOf(address) ?? '—'} · ${dialInUnknownReason(connect, relays)}`
  }
  if (direction === 'listener') {
    return `${stripPassphrase(address)}${withPassphrase} · ${connect ? dialInUnknownReason(connect) : 'Strom host not known'}`
  }
  return address
}

/**
 * The address an Edit of a relay document sends, or undefined to leave the
 * stored one alone. Like a listener: an unchanged relay address with no new
 * passphrase is not sent, so the masked passphrase the backend returned is
 * never written back. Otherwise `auto`, and the backend keeps the stream ID.
 * The backend keeps the stored passphrase on an `auto` address without a
 * `passphrase` key, so moving to another relay with a blank field keeps it
 * (the relay never sees it; the stream stays encrypted end to end).
 * `removePassphrase` sends an empty `passphrase=`, which removes it, on the
 * stored relay or another one.
 *
 * `relay` is the relay chosen in the form (default: the stored one). On the
 * stored relay the address is `auto` without `@`, which keeps the stored relay;
 * on another one it is `auto@<relay>`, also `auto@default` to move back to the
 * default relay. A document that was not a relay address yet gets the create
 * form (default relay without `@`).
 */
export function relayAddressPatch(edit: {
  storedDirection: SrtDirection | null
  /** The stored relay (`relayNameOf`), when the stored address is a relay address. */
  storedRelay?: string | null
  relay?: string
  passphrase: string
  removePassphrase?: boolean
}): string | undefined {
  const { storedDirection, passphrase } = edit
  if (storedDirection !== 'relay') return buildRelayAddress(passphrase, edit.relay)
  const stored = edit.storedRelay ?? DEFAULT_RELAY
  const chosen = edit.relay ?? stored
  const at = chosen !== stored ? chosen : undefined
  if (edit.removePassphrase) return `${autoRelayAddress(undefined, at)}?passphrase=`
  return at || passphrase.trim() ? autoRelayAddress(passphrase, at) : undefined
}

/**
 * The relay the form uses: the one picked when Strom has it (or it is the
 * stored one), else the stored relay, else the first one Strom reports
 * (`default` first), else `default`.
 */
export function chosenRelay(picked: string, relays: SrtRelayEndpoint[], storedRelay?: string | null): string {
  if (picked && (picked === storedRelay || relays.some((r) => r.name === picked))) return picked
  return storedRelay ?? relays[0]?.name ?? DEFAULT_RELAY
}

/**
 * The SRT passphrase rule, checked on the raw value before it is URL-encoded:
 * empty (none), or 10–80 bytes in UTF-8, so "å" counts as 2: the libsrt limit,
 * which Strom and the Open Live backend both check on the decoded value. Null
 * when it is fine.
 */
export function passphraseError(passphrase: string): string | null {
  const p = passphrase.trim()
  if (!p) return null
  const bytes = new TextEncoder().encode(p).length
  return bytes < 10 || bytes > 80
    ? `The passphrase must be 10–80 bytes (it is ${bytes}; letters such as å count as 2).`
    : null
}

/**
 * The first query key without `=` in an SRT address (`srt://h:1?latency`), or
 * null. Such a key crashes GStreamer when the SRT element starts, so the backend
 * refuses it (400) and the studio never sends one. Empty segments (`?&a=1`) are
 * fine: they are skipped.
 */
export function bareQueryKey(address: string): string | null {
  const q = address.indexOf('?')
  if (q === -1) return null
  for (const param of address.slice(q + 1).split('#')[0]!.split('&')) {
    if (param && !param.includes('=')) return param
  }
  return null
}

/** The message for an SRT address with a query key without a value, or null. */
export function bareQueryKeyError(address: string): string | null {
  const key = bareQueryKey(address)
  return key === null ? null : `The SRT parameter "${key}" has no value, which crashes GStreamer. Write ${key}=<value>, or remove it.`
}

/** Whether a typed SRT address asks for rendezvous mode. */
export function isRendezvousAddress(address: string): boolean {
  return /^srt:\/\//i.test(address.trim()) && /[?&]mode=rendezvous(?:[&#]|$)/i.test(address)
}

/**
 * What the direction pickers offer, from server-info `srt`. Only a definite
 * answer from Strom (`state: ok`) hides a mode: while the state is `unknown`,
 * `unreachable` or `unsupported` (or the backend is too old to report `srt`)
 * every mode is offered. "Via relay" needs at least one relay; the relay picker
 * shows when there is more than one, or the only one is not `default`.
 */
export interface SrtOffer {
  state: SrtCapabilities['state']
  listener: boolean
  rendezvous: boolean
  relays: SrtRelayEndpoint[]
  relayPicker: boolean
  /**
   * A line under the direction choice. `blocked`: Strom says listener cannot
   * work here. `unreachable`: a subtle note that Strom did not answer the last
   * check, so everything is offered.
   */
  note: { kind: 'blocked' | 'unreachable'; text: string } | null
}

/** The explanation for a Strom that cannot be reached from outside. */
export function unreachableFromOutsideText(relays: boolean): string {
  return relays
    ? 'This Strom cannot be reached from outside; use caller or Via relay.'
    : 'This Strom cannot be reached from outside; use caller.'
}

export function srtOffer(srt: SrtCapabilities | undefined | null): SrtOffer {
  const state = srt?.state ?? 'unknown'
  const relays = srt?.relays ?? []
  const definite = state === 'ok'
  const listener = !definite || srt?.modes.listener !== false
  const rendezvous = !definite || srt?.modes.rendezvous !== false
  const note: SrtOffer['note'] = !listener
    ? { kind: 'blocked', text: unreachableFromOutsideText(relays.length > 0) }
    : state === 'unreachable'
      ? { kind: 'unreachable', text: 'Strom did not answer the last check of what SRT can do here, so every direction is offered.' }
      : null
  return {
    state,
    listener,
    rendezvous,
    relays,
    relayPicker: relays.length > 1 || (relays.length === 1 && relays[0]!.name !== DEFAULT_RELAY),
    note,
  }
}

/**
 * The direction a form shows: the chosen one if it is offered, or is the
 * stored direction (an existing document stays editable as it is); otherwise
 * caller, which always works.
 */
export function offeredDirection(chosen: SrtDirection, offer: SrtOffer, stored?: SrtDirection | null): SrtDirection {
  if (chosen === stored) return chosen
  if (chosen === 'listener' && !offer.listener) return 'caller'
  if (chosen === 'relay' && offer.relays.length === 0) return offer.listener ? 'listener' : 'caller'
  return chosen
}

/**
 * Why a typed rendezvous address cannot be saved, or null. Only a new or
 * changed address is refused; a stored one stays editable as it is.
 */
export function rendezvousError(address: string, offer: SrtOffer, stored?: string): string | null {
  if (offer.rendezvous || !isRendezvousAddress(address) || address.trim() === stored?.trim()) return null
  return `Rendezvous will not work here. ${unreachableFromOutsideText(offer.relays.length > 0)}`
}

/** `connect.warning` in an operator's words, or null. */
export function srtConnectWarningText(connect: SrtConnect | undefined): string | null {
  switch (connect?.warning) {
    case undefined:
      return null
    case 'srt-listener-unsupported':
      return 'Strom reports that it cannot be reached from outside, so this listener address will not work. Switch to caller or Via relay.'
    case 'srt-rendezvous-unsupported':
      return 'Strom reports that it cannot be reached from outside, so this rendezvous address will not work. Switch to caller or Via relay.'
    case 'srt-port-outside-strom-ports':
      return 'This listener port is outside the ports Strom is set up for (STROM_PORTS), so senders may not reach it. Pick a port in that range.'
    default:
      return 'Strom reports that this SRT mode will not work here.'
  }
}

/**
 * A readable message for a failed source or output save caused by its SRT
 * address, or null to use the general message:
 * - 422 `srt-relay-not-configured`, pointing to the directions that work here
 *   (`offer`: listener only when Strom can be reached from outside);
 * - 422 `srt-relay-unknown`, with the relays Strom has;
 * - 400 for a query key without a value.
 */
export function srtSaveErrorMessage(err: unknown, offer: Pick<SrtOffer, 'listener'>): string | null {
  // Read by shape, not `instanceof`: importing the ApiError class would pull
  // the API client (and its browser-only auth) into this pure module.
  if (!isApiError(err)) return null
  const body = err.body as Partial<SrtRelayErrorBody> | undefined
  if (err.status === 422 && body?.code === 'srt-relay-not-configured') {
    const instead = offer.listener ? 'Choose listener or caller.' : unreachableFromOutsideText(false)
    return `Strom reports no SRT relay, so "Via relay" cannot be used here. ${instead}`
  }
  if (err.status === 422 && body?.code === 'srt-relay-unknown') {
    const names = Array.isArray(body.relays) ? body.relays : []
    return `Strom has no SRT relay of that name. ${names.length ? `Configured relays: ${names.join(', ')}. Pick one of them.` : 'Pick another relay.'}`
  }
  if (err.status === 400) {
    const m = /SRT parameter '([^']*)' has no value/.exec(err.message)
    if (m) return bareQueryKeyError(`?${m[1]}`)
  }
  return null
}

function isApiError(err: unknown): err is ApiError {
  return err instanceof Error && typeof (err as Partial<ApiError>).status === 'number'
}

/** One of Strom's STROM_PORTS spans (server-info `srt.ports`), inclusive. */
export type PortSpan = { first: number; last: number }

/** Whether `port` lies in one of the spans. */
export function portInSpans(port: number, spans: readonly PortSpan[]): boolean {
  return spans.some((s) => port >= s.first && port <= s.last)
}

/**
 * Up to `limit` ports from the spans, lowest first, skipping `used` (the
 * listener ports of the listed sources and outputs).
 */
export function freePortsInSpans(spans: readonly PortSpan[], used: Iterable<number>, limit: number): number[] {
  const taken = new Set(used)
  const out: number[] = []
  const sorted = [...spans].sort((a, b) => a.first - b.first)
  for (const s of sorted) {
    for (let p = Math.max(1, s.first); p <= Math.min(65535, s.last) && out.length < limit; p++) {
      if (!taken.has(p) && !out.includes(p)) out.push(p)
    }
    if (out.length >= limit) break
  }
  return out
}

/** The spans as an operator reads them: `47100–47199, 48000`. */
export function describeSpans(spans: readonly PortSpan[]): string {
  return [...spans]
    .sort((a, b) => a.first - b.first)
    .map((s) => (s.first === s.last ? `${s.first}` : `${s.first}\u2013${s.last}`))
    .join(', ')
}
