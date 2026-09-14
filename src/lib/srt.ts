/**
 * The two shapes an SRT address takes in Open Live, and how to move between them.
 *
 * A listener address is hostless: `srt://:PORT?mode=listener`. Strom binds PORT on
 * the shared server and waits for a sender, so the port has to come from this
 * instance's range and be free; port 0 asks the backend to pick one. A caller
 * address names the far end, `srt://host:PORT?mode=caller`, and binds nothing here.
 */

export type SrtDirection = 'listener' | 'caller'

/** Which way a stored SRT address points. Hostless means Strom listens. */
export function srtDirection(address: string): SrtDirection {
  const a = address.trim()
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
