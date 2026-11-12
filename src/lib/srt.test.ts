import { describe, expect, it } from 'vitest'
import {
  srtDirection,
  listenerPort,
  passphraseOf,
  buildListenerAddress,
  stripPassphrase,
  toCallerUrl,
  isCallerAddress,
  hasMaskedPassphrase,
  listenerEditAddress,
  maskedPassphraseError,
  isRelayAddress,
  relayIdOf,
  buildRelayAddress,
  dialInAddress,
  dialInUnknownReason,
  dialInIsLocalOnly,
  passphraseError,
  relayAddressPatch,
  srtRowLabel,
} from './srt'
import type { SrtConnect } from './api'

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

describe('listenerEditAddress', () => {
  const stored = 'srt://:9000?mode=listener&passphrase=***'

  it('removes the passphrase when asked, even with text in the field', () => {
    expect(listenerEditAddress({ stored, port: 9000, passphrase: 'ignored-value', removePassphrase: true })).toBe(
      'srt://:9000?mode=listener',
    )
  })

  it('sends nothing for an empty field, so the stored passphrase is kept', () => {
    expect(listenerEditAddress({ stored, port: 9000, passphrase: '  ', removePassphrase: false })).toBeUndefined()
  })

  it('sends a newly typed passphrase', () => {
    expect(listenerEditAddress({ stored, port: 9000, passphrase: 'new-secret-123', removePassphrase: false })).toBe(
      'srt://:9000?mode=listener&passphrase=new-secret-123',
    )
  })

  it('sends the listener address when switching from caller', () => {
    expect(
      listenerEditAddress({ stored: 'srt://host.example:9000?mode=caller', port: 0, passphrase: '', removePassphrase: false }),
    ).toBe('srt://:0?mode=listener')
  })
})

describe('maskedPassphraseError', () => {
  const stored = 'srt://host.example:9000?mode=caller&passphrase=***'

  it('detects the masked passphrase', () => {
    expect(hasMaskedPassphrase(stored)).toBe(true)
    expect(hasMaskedPassphrase('srt://host.example:9000?passphrase=real-secret')).toBe(false)
  })

  it('allows the unchanged address (it is not sent)', () => {
    expect(maskedPassphraseError(stored, stored)).toBeNull()
  })

  it('blocks a changed address that still carries the mask', () => {
    expect(maskedPassphraseError('srt://other.example:9000?mode=caller&passphrase=***', stored)).not.toBeNull()
  })

  it('allows a changed address with a real or no passphrase', () => {
    expect(maskedPassphraseError('srt://other.example:9000?mode=caller&passphrase=real-secret', stored)).toBeNull()
    expect(maskedPassphraseError('srt://other.example:9000?mode=caller', stored)).toBeNull()
  })
})

describe('relay addresses', () => {
  it('are recognised and read as their own direction', () => {
    expect(isRelayAddress('srt+relay://abc')).toBe(true)
    expect(isRelayAddress('srt://:9000')).toBe(false)
    expect(srtDirection('srt+relay://abc?passphrase=***')).toBe('relay')
  })

  it('carry a stream ID', () => {
    expect(relayIdOf('srt+relay://abc_123?passphrase=***')).toBe('abc_123')
    expect(relayIdOf('srt+relay://abc-1')).toBe('abc-1')
    expect(relayIdOf('srt://:9000')).toBeNull()
  })

  it('are built as auto, with an optional encoded passphrase', () => {
    expect(buildRelayAddress()).toBe('srt+relay://auto')
    expect(buildRelayAddress('  ')).toBe('srt+relay://auto')
    expect(buildRelayAddress('pass word!1')).toBe('srt+relay://auto?passphrase=pass%20word!1')
  })

  it('bind no listener port', () => {
    expect(listenerPort('srt+relay://abc')).toBeNull()
  })
})

describe('dialInAddress', () => {
  const CONNECT: SrtConnect = {
    uri: 'srt://relay.example.com:9000?streamid=abc', host: 'relay.example.com', port: 9000, mode: 'caller', source: 'srt-relay', streamid: 'abc',
  }

  it('relay: the backend connect uri, or null while it is unknown', () => {
    expect(dialInAddress('srt+relay://abc?passphrase=***', CONNECT, 'strom.example')).toBe('srt://relay.example.com:9000?streamid=abc')
    expect(dialInAddress('srt+relay://abc', { ...CONNECT, uri: null, reason: 'srt-relay-public-unknown' })).toBeNull()
    expect(dialInAddress('srt+relay://abc', undefined)).toBeNull()
  })

  it('listener: the backend connect decides (SRT_PUBLIC_HOST), not the Strom host', () => {
    const connect: SrtConnect = { uri: 'srt://srt.example.com:1234?mode=caller', host: 'srt.example.com', port: 1234, mode: 'caller', source: 'srt-public-host' }
    expect(dialInAddress('srt://:1234?mode=listener', connect, 'strom.example')).toBe('srt://srt.example.com:1234?mode=caller')
  })

  it('listener on a private or localhost Strom: the Strom host, marked local only', () => {
    const privateHost: SrtConnect = { uri: null, host: '10.0.0.5', port: 1234, mode: 'caller', source: 'strom-host', reason: 'srt-host-not-loopback-reachable' }
    expect(dialInAddress('srt://:1234?mode=listener&passphrase=***', privateHost)).toBe('srt://10.0.0.5:1234?mode=caller')
    expect(dialInAddress('srt://:1234?mode=listener', { ...privateHost, host: null }, '10.0.0.6')).toBe('srt://10.0.0.6:1234?mode=caller')
    expect(dialInIsLocalOnly('srt://:1234?mode=listener', privateHost)).toBe(true)
    expect(srtRowLabel('srt://:1234?mode=listener&passphrase=***', privateHost, undefined, 'sender dials')).toBe(
      'sender dials srt://10.0.0.5:1234?mode=caller with the passphrase · local network only (set SRT_PUBLIC_HOST on the backend for a public address)',
    )
  })

  it('listener with no host known at all: nothing to dial, and the row says why', () => {
    const unparseable: SrtConnect = { uri: null, host: null, port: 1234, mode: 'caller', source: 'unknown', reason: 'strom-url-not-parseable' }
    expect(dialInAddress('srt://:1234?mode=listener', unparseable)).toBeNull()
    expect(srtRowLabel('srt://:1234?mode=listener', unparseable, undefined, 'x')).toMatch(/^srt:\/\/:1234\?mode=listener · public SRT host not known/)
    expect(dialInAddress('srt://:1234?mode=listener&passphrase=***', undefined)).toBeNull()
    expect(srtRowLabel('srt://:1234?mode=listener&passphrase=***', undefined, undefined, 'x')).toBe(
      'srt://:1234?mode=listener with the passphrase · Strom host not known',
    )
  })

  it('listener on an older backend without connect: the Strom host with the mode flipped', () => {
    expect(dialInAddress('srt://:1234?mode=listener&passphrase=***', undefined, 'host.example')).toBe('srt://host.example:1234?mode=caller')
  })

  it('caller: nothing to dial, whatever connect says', () => {
    const connect: SrtConnect = { uri: 'srt://host.example:1234?mode=listener', host: 'host.example', port: 1234, mode: 'listener', source: 'authored-host' }
    expect(dialInAddress('srt://host.example:1234?mode=caller', connect, 'strom.example')).toBeNull()
  })
})

describe('srtRowLabel', () => {
  const unresolved = (reason: string): SrtConnect => ({ uri: null, host: null, port: null, mode: 'caller', source: 'srt-relay', streamid: 'abc', reason })

  it('says who dials what, with the passphrase when one is set', () => {
    const connect: SrtConnect = { uri: 'srt://relay.example.com:9000?streamid=abc', host: 'relay.example.com', port: 9000, mode: 'caller', source: 'srt-relay', streamid: 'abc' }
    expect(srtRowLabel('srt+relay://abc?passphrase=***', connect, undefined, 'sender dials')).toBe('sender dials srt://relay.example.com:9000?streamid=abc with the passphrase')
  })

  it('gives the reason when a relay dial-in address is unknown', () => {
    expect(srtRowLabel('srt+relay://abc', unresolved('srt-relay-not-configured'), undefined, 'x')).toBe('via relay · stream ID abc · Strom reports no SRT relay')
    expect(srtRowLabel('srt+relay://abc', unresolved('srt-relay-unreachable'), undefined, 'x')).toBe('via relay · stream ID abc · relay status unavailable, Strom is not answering')
    expect(srtRowLabel('srt+relay://abc', unresolved('srt-relay-public-unknown'), undefined, 'x')).toBe('via relay · stream ID abc · relay address not known')
    expect(srtRowLabel('srt+relay://abc', undefined, undefined, 'x')).toBe('via relay · stream ID abc · relay address not known')
  })

  it('a caller address is shown as stored', () => {
    expect(srtRowLabel('srt://cdn.example.com:9000?mode=caller', undefined, 'strom', 'x')).toBe('srt://cdn.example.com:9000?mode=caller')
  })

  it('reason texts', () => {
    expect(dialInUnknownReason({ uri: null, host: null, port: 1, mode: 'caller', source: 'strom-host', reason: 'srt-host-not-loopback-reachable' })).toMatch(/SRT_PUBLIC_HOST/)
  })
})

describe('relayAddressPatch', () => {
  it('leaves a stored relay address alone without a new passphrase', () => {
    expect(relayAddressPatch('relay', '')).toBeUndefined()
    expect(relayAddressPatch('relay', '   ')).toBeUndefined()
  })
  it('sends auto with a new passphrase, or when switching to relay', () => {
    expect(relayAddressPatch('relay', 'anothersecret')).toBe('srt+relay://auto?passphrase=anothersecret')
    expect(relayAddressPatch('listener', '')).toBe('srt+relay://auto')
    expect(relayAddressPatch(null, '')).toBe('srt+relay://auto')
  })
  it('removes a stored passphrase when asked, even with text in the field', () => {
    expect(relayAddressPatch('relay', 'ignored-value', true)).toBe('srt+relay://auto')
    expect(relayAddressPatch('listener', 'pass-123456', true)).toBe('srt+relay://auto?passphrase=pass-123456')
  })
})

describe('passphraseError', () => {
  it('accepts none, or 10–79 characters counted before URL encoding', () => {
    expect(passphraseError('')).toBeNull()
    expect(passphraseError('   ')).toBeNull()
    expect(passphraseError('a'.repeat(10))).toBeNull()
    expect(passphraseError('a'.repeat(79))).toBeNull()
    // 10 raw characters that encode to more: still fine.
    expect(passphraseError('&&&&&&&&&&')).toBeNull()
  })
  it('refuses shorter or longer ones with a clear message', () => {
    expect(passphraseError('short')).toBe('The passphrase must be 10–79 characters (it is 5).')
    expect(passphraseError('a'.repeat(80))).toMatch(/10–79 characters \(it is 80\)/)
  })
})
