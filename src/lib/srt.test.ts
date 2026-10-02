import { describe, expect, it } from 'vitest'
import {
  srtDirection,
  listenerPort,
  passphraseOf,
  buildListenerAddress,
  stripPassphrase,
  toCallerUrl,
  isCallerAddress,
} from './srt'

describe('srtDirection', () => {
  it('treats a hostless address without a caller mode as a listener', () => {
    expect(srtDirection('srt://:1234')).toBe('listener')
    expect(srtDirection('srt://:1234?mode=listener')).toBe('listener')
  })

  it('treats a hostless caller/rendezvous address as a caller', () => {
    expect(srtDirection('srt://:1234?mode=caller')).toBe('caller')
    expect(srtDirection('srt://:1234?mode=rendezvous')).toBe('caller')
  })

  it('treats any address that names a host as a caller', () => {
    expect(srtDirection('srt://host.example:1234')).toBe('caller')
  })
})

describe('listenerPort', () => {
  it('extracts the port of a hostless listener address', () => {
    expect(listenerPort('srt://:1234?mode=listener')).toBe(1234)
    expect(listenerPort('srt://:9000')).toBe(9000)
  })

  it('returns null for port 0 (backend-assigned) and out-of-range ports', () => {
    expect(listenerPort('srt://:0?mode=listener')).toBeNull()
    expect(listenerPort('srt://:70000')).toBeNull()
  })

  it('returns null when a host is present', () => {
    expect(listenerPort('srt://host:1234')).toBeNull()
  })
})

describe('passphraseOf', () => {
  it('decodes the passphrase parameter', () => {
    expect(passphraseOf('srt://:1234?passphrase=secret')).toBe('secret')
    expect(passphraseOf('srt://:1234?mode=listener&passphrase=a%20b')).toBe('a b')
  })

  it('returns null when there is no passphrase', () => {
    expect(passphraseOf('srt://:1234?mode=listener')).toBeNull()
  })
})

describe('buildListenerAddress', () => {
  it('builds a listener address with and without a passphrase', () => {
    expect(buildListenerAddress(1234)).toBe('srt://:1234?mode=listener')
    expect(buildListenerAddress(1234, 'pass')).toBe('srt://:1234?mode=listener&passphrase=pass')
  })

  it('URL-encodes the passphrase', () => {
    expect(buildListenerAddress(1234, 'a b')).toBe('srt://:1234?mode=listener&passphrase=a%20b')
  })

  it('emits port 0 for backend-chosen ports', () => {
    expect(buildListenerAddress(0)).toBe('srt://:0?mode=listener')
  })
})

describe('stripPassphrase', () => {
  it('removes a trailing passphrase parameter', () => {
    expect(stripPassphrase('srt://:1234?mode=listener&passphrase=pass')).toBe(
      'srt://:1234?mode=listener',
    )
  })

  it('removes a leading passphrase parameter and keeps the rest', () => {
    expect(stripPassphrase('srt://:1234?passphrase=pass&mode=listener')).toBe(
      'srt://:1234?mode=listener',
    )
  })

  it('removes a sole passphrase parameter and the dangling question mark', () => {
    expect(stripPassphrase('srt://:1234?passphrase=pass')).toBe('srt://:1234')
  })
})

describe('toCallerUrl', () => {
  it('fills in the Strom host and flips the mode to caller', () => {
    expect(toCallerUrl('srt://:1234?mode=listener', 'host.example')).toBe(
      'srt://host.example:1234?mode=caller',
    )
  })

  it('strips the passphrase from the dialled address', () => {
    expect(toCallerUrl('srt://:1234?mode=listener&passphrase=pass', 'host.example')).toBe(
      'srt://host.example:1234?mode=caller',
    )
  })

  it('leaves the address hostless when no Strom host is given', () => {
    expect(toCallerUrl('srt://:1234?mode=listener')).toBe('srt://:1234?mode=caller')
  })
})

describe('isCallerAddress', () => {
  it('accepts addresses that name a host and port', () => {
    expect(isCallerAddress('srt://host.example:1234')).toBe(true)
    expect(isCallerAddress('srt://host:1234?mode=caller')).toBe(true)
    expect(isCallerAddress('srt://[2001:db8::1]:1234')).toBe(true)
  })

  it('rejects hostless addresses', () => {
    expect(isCallerAddress('srt://:1234')).toBe(false)
  })
})
