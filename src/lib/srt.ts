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
 * The relay address to PATCH when an edit is saved, or undefined to leave the
 * stored one alone. Same rules as a listener: `removePassphrase` on a stored relay
 * address sends it without a passphrase; a typed passphrase, or a switch from
 * another direction, sends a new one; otherwise nothing is sent, so the masked
 * `***` is never written back. Always `auto`: the backend keeps the stream ID.
 */
export function relayEditAddress(edit: {
  stored: string
  passphrase: string
  removePassphrase: boolean
}): string | undefined {
  const switched = srtDirection(edit.stored) !== 'relay'
  if (edit.removePassphrase && !switched) return buildRelayAddress()
  if (switched || edit.passphrase.trim()) return buildRelayAddress(edit.passphrase)
  return undefined
}

/**
 * The address the outside party dials for a stored SRT address, or null when
 * there is none to show. A listener: the Strom host with the mode flipped. A
 * relay: the backend's `connect.uri` (`srt://<relay>?streamid=<id>`), which is
 * null while the relay's public address is unknown. A caller address points
 * elsewhere, so nobody dials us. Never carries the passphrase.
 */
export function dialInAddress(address: string, connect: SrtConnect | undefined, stromHost?: string): string | null {
  const direction = srtDirection(address)
  if (direction === 'relay') return connect?.uri ?? null
  if (direction === 'listener') return toCallerUrl(address, stromHost)
  return null
}
