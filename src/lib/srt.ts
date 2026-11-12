/**
 * The three shapes an SRT address takes in Open Live, and how to move between them.
 *
 * A listener address is hostless: `srt://:PORT?mode=listener`. Strom binds PORT on
 * the shared server and waits for a sender, so the port has to come from this
 * instance's range and be free; port 0 asks the backend to pick one. A caller
 * address names the far end, `srt://host:PORT?mode=caller`, and binds nothing here.
 * A relay address, `srt+relay://<id>`, is a session on the SRT relay Strom fronts:
 * one public UDP port where Strom and the outside party both call in with the
 * same stream ID. `srt+relay://auto` asks the backend to generate the ID; it is
 * kept from then on, also when an edit sends `auto` again.
 */

import type { SrtConnect } from './api'

export type SrtDirection = 'listener' | 'caller' | 'relay'

/** Whether the address is an SRT relay address (`srt+relay://…`). */
export function isRelayAddress(address: string | undefined | null): boolean {
  return !!address && /^srt\+relay:\/\//i.test(address.trim())
}

/** The stream ID of a relay address, or null. */
export function relayIdOf(address: string): string | null {
  const m = /^srt\+relay:\/\/([A-Za-z0-9_-]{1,64})(?:[?#]|$)/i.exec(address.trim())
  return m ? (m[1] ?? null) : null
}

/**
 * A relay address for a new or re-saved document. The backend generates the
 * stream ID for `auto`, or keeps the one the document already has.
 */
export function buildRelayAddress(passphrase?: string): string {
  const p = passphrase?.trim()
  return `srt+relay://auto${p ? `?passphrase=${encodeURIComponent(p)}` : ''}`
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
  return `srt://:${port}?mode=listener${p ? `&passphrase=${encodeURIComponent(p)}` : ''}`
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

/** Why the backend could not give a dial-in address, in an operator's words. */
export function dialInUnknownReason(connect: SrtConnect | undefined): string {
  switch (connect?.reason) {
    case 'srt-relay-not-configured':
      return 'Strom reports no SRT relay'
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
export function srtRowLabel(address: string, connect: SrtConnect | undefined, stromHost: string | undefined, dials: string): string {
  const direction = srtDirection(address)
  const dialIn = dialInAddress(address, connect, stromHost)
  const withPassphrase = passphraseOf(address) !== null ? ' with the passphrase' : ''
  if (dialIn) {
    const localOnly = dialInIsLocalOnly(address, connect) ? ' · local network only (set SRT_PUBLIC_HOST on the backend for a public address)' : ''
    return `${dials} ${dialIn}${withPassphrase}${localOnly}`
  }
  if (direction === 'relay') return `via relay · stream ID ${relayIdOf(address) ?? '—'} · ${dialInUnknownReason(connect)}`
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
 * `removePassphrase` on a stored relay address sends it without a passphrase,
 * which removes it (the backend replaces a sent address in full).
 */
export function relayAddressPatch(storedDirection: SrtDirection | null, passphrase: string, removePassphrase = false): string | undefined {
  if (removePassphrase && storedDirection === 'relay') return buildRelayAddress()
  return storedDirection !== 'relay' || passphrase.trim() ? buildRelayAddress(passphrase) : undefined
}

/**
 * The SRT (libsrt) passphrase rule, checked on the raw value before it is
 * URL-encoded: empty (none), or 10–79 characters. Null when it is fine.
 */
export function passphraseError(passphrase: string): string | null {
  const p = passphrase.trim()
  if (!p) return null
  return p.length < 10 || p.length > 79
    ? `The passphrase must be 10–79 characters (it is ${p.length}).`
    : null
}
