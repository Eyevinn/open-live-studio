import { describe, expect, it, vi } from 'vitest'

// api.ts reads `window._env_` and the SAT auth on import; stub both so the real
// ApiError class can be loaded in the node test environment.
vi.mock('./base.js', () => ({ BASE: 'http://test' }))
vi.mock('./sat.js', () => ({ authenticateWithOpenLive: vi.fn(), getApiToken: vi.fn().mockResolvedValue(null) }))
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
  encodePassphrase,
  srtRowLabel,
  relayNameOf,
  chosenRelay,
  bareQueryKey,
  bareQueryKeyError,
  isRendezvousAddress,
  srtOffer,
  offeredDirection,
  rendezvousError,
  srtConnectWarningText,
  srtSaveErrorMessage,
  portInSpans,
  freePortsInSpans,
  describeSpans,
} from './srt'
import { ApiError, type SrtCapabilities, type SrtConnect } from './api'

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

describe('encodePassphrase', () => {
  const BACKEND_QUERY_CHARS = /^[A-Za-z0-9._\-=&%+]+$/

  it("percent-encodes ! * ' ( ) ~, which encodeURIComponent leaves", () => {
    expect(encodePassphrase("my!secret(2024)*'~")).toBe('my%21secret%282024%29%2A%27%7E')
  })

  it('gives addresses the backend query charset accepts, and decodes back', () => {
    const p = "a b!c*d'e(f)g~h/i?j&k=l#m+nå"
    expect(decodeURIComponent(encodePassphrase(p))).toBe(p)
    expect(buildRelayAddress(p).split('?')[1]).toMatch(BACKEND_QUERY_CHARS)
    expect(buildListenerAddress(9000, p).split('?')[1]).toMatch(BACKEND_QUERY_CHARS)
    expect(passphraseOf(buildListenerAddress(9000, p))).toBe(p)
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
    expect(relayIdOf('srt+relay://abc-1@eu-north?passphrase=***')).toBe('abc-1')
    expect(relayIdOf('srt://:9000')).toBeNull()
  })

  it('name their relay, default without @', () => {
    expect(relayNameOf('srt+relay://abc')).toBe('default')
    expect(relayNameOf('srt+relay://abc?passphrase=***')).toBe('default')
    expect(relayNameOf('srt+relay://abc@eu-north?passphrase=***')).toBe('eu-north')
    expect(relayNameOf('srt+relay://abc@Bad_Name')).toBeNull()
    expect(relayNameOf('srt://:9000')).toBeNull()
  })

  it('are built as auto, with an optional encoded passphrase', () => {
    expect(buildRelayAddress()).toBe('srt+relay://auto')
    expect(buildRelayAddress('  ')).toBe('srt+relay://auto')
    expect(buildRelayAddress('pass word!1')).toBe('srt+relay://auto?passphrase=pass%20word%211')
  })

  it('are built as auto@<relay> on a named relay, and without @ on the default one', () => {
    expect(buildRelayAddress('', 'eu-north')).toBe('srt+relay://auto@eu-north')
    expect(buildRelayAddress('supersecret1', 'eu-north')).toBe('srt+relay://auto@eu-north?passphrase=supersecret1')
    expect(buildRelayAddress('supersecret1', 'default')).toBe('srt+relay://auto?passphrase=supersecret1')
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

  it('names the relay and the configured ones for srt-relay-unknown', () => {
    const connect: SrtConnect = { ...unresolved('srt-relay-unknown'), relay: 'eu-north' }
    expect(srtRowLabel('srt+relay://abc@eu-north', connect, undefined, 'x', [{ name: 'default', public: 'srt.example.com:9000' }]))
      .toBe('via relay eu-north · stream ID abc · Strom has no SRT relay named "eu-north" (configured: default); edit it and pick another relay')
    expect(dialInUnknownReason(connect)).toBe('Strom has no SRT relay named "eu-north"; edit it and pick another relay')
  })

  it('reason texts', () => {
    expect(dialInUnknownReason({ uri: null, host: null, port: 1, mode: 'caller', source: 'strom-host', reason: 'srt-host-not-loopback-reachable' })).toMatch(/SRT_PUBLIC_HOST/)
  })
})

describe('relayAddressPatch', () => {
  it('leaves a stored relay address alone without a new passphrase', () => {
    expect(relayAddressPatch({ storedDirection: 'relay', passphrase: '' })).toBeUndefined()
    expect(relayAddressPatch({ storedDirection: 'relay', passphrase: '   ' })).toBeUndefined()
    expect(relayAddressPatch({ storedDirection: 'relay', storedRelay: 'eu-north', relay: 'eu-north', passphrase: '' })).toBeUndefined()
  })
  it('sends auto with a new passphrase, or when switching to relay', () => {
    expect(relayAddressPatch({ storedDirection: 'relay', passphrase: 'anothersecret' })).toBe('srt+relay://auto?passphrase=anothersecret')
    expect(relayAddressPatch({ storedDirection: 'listener', passphrase: '' })).toBe('srt+relay://auto')
    expect(relayAddressPatch({ storedDirection: null, passphrase: '' })).toBe('srt+relay://auto')
  })
  it('renews the passphrase with auto without @, which keeps the stored relay', () => {
    expect(relayAddressPatch({ storedDirection: 'relay', storedRelay: 'eu-north', relay: 'eu-north', passphrase: 'anothersecret' }))
      .toBe('srt+relay://auto?passphrase=anothersecret')
  })
  it('switches relay with auto@<relay>, and back to the default one with auto@default', () => {
    expect(relayAddressPatch({ storedDirection: 'relay', storedRelay: 'default', relay: 'eu-north', passphrase: 'anothersecret' }))
      .toBe('srt+relay://auto@eu-north?passphrase=anothersecret')
    expect(relayAddressPatch({ storedDirection: 'relay', storedRelay: 'eu-north', relay: 'default', passphrase: '' }))
      .toBe('srt+relay://auto@default')
    expect(relayAddressPatch({ storedDirection: 'relay', storedRelay: 'eu-north', relay: 'default', passphrase: '', removePassphrase: true }))
      .toBe('srt+relay://auto@default?passphrase=')
  })
  it('a relay switch with a blank field sends auto@<relay> without a passphrase key (the backend keeps the stored one)', () => {
    expect(relayAddressPatch({ storedDirection: 'relay', storedRelay: 'default', relay: 'eu-north', passphrase: '' }))
      .toBe('srt+relay://auto@eu-north')
    expect(relayAddressPatch({ storedDirection: 'relay', storedRelay: 'default', relay: 'eu-north', passphrase: '   ' }))
      .toBe('srt+relay://auto@eu-north')
  })
  it('a listener or caller switched to a named relay uses auto@<relay>', () => {
    expect(relayAddressPatch({ storedDirection: 'listener', relay: 'eu-north', passphrase: '' })).toBe('srt+relay://auto@eu-north')
    expect(relayAddressPatch({ storedDirection: 'caller', relay: 'default', passphrase: '' })).toBe('srt+relay://auto')
  })
  it('removes a stored passphrase when asked, even with text in the field', () => {
    expect(relayAddressPatch({ storedDirection: 'relay', passphrase: 'ignored-value', removePassphrase: true })).toBe('srt+relay://auto?passphrase=')
    expect(relayAddressPatch({ storedDirection: 'relay', storedRelay: 'eu-north', relay: 'eu-north', passphrase: '', removePassphrase: true }))
      .toBe('srt+relay://auto?passphrase=')
    expect(relayAddressPatch({ storedDirection: 'listener', passphrase: 'pass-123456', removePassphrase: true })).toBe('srt+relay://auto?passphrase=pass-123456')
  })
})

describe('chosenRelay', () => {
  const relays = [{ name: 'default', public: 'srt.example.com:9000' }, { name: 'eu-north', public: 'eu.example.com:9000' }]
  it('uses the picked relay when Strom has it, or it is the stored one', () => {
    expect(chosenRelay('eu-north', relays)).toBe('eu-north')
    expect(chosenRelay('gone', relays, 'gone')).toBe('gone')
  })
  it('falls back to the stored relay, then the first one, then default', () => {
    expect(chosenRelay('', relays, 'eu-north')).toBe('eu-north')
    expect(chosenRelay('', relays)).toBe('default')
    expect(chosenRelay('unknown', [{ name: 'eu-north', public: 'x:1' }])).toBe('eu-north')
    expect(chosenRelay('', [])).toBe('default')
  })
})

describe('bareQueryKey', () => {
  it('finds a query key without =', () => {
    expect(bareQueryKey('srt://h:1?latency')).toBe('latency')
    expect(bareQueryKey('srt://h:1?mode=caller&latency')).toBe('latency')
    expect(bareQueryKeyError('srt://h:1?latency&mode=caller')).toBe('The SRT parameter "latency" has no value, which crashes GStreamer. Write latency=<value>, or remove it.')
  })
  it('accepts keys with values, empty values and empty segments', () => {
    expect(bareQueryKey('srt://h:1')).toBeNull()
    expect(bareQueryKey('srt://h:1?')).toBeNull()
    expect(bareQueryKey('srt://h:1?mode=caller&&latency=200')).toBeNull()
    expect(bareQueryKey('srt://h:1?passphrase=')).toBeNull()
    expect(bareQueryKeyError('srt://h:1?mode=caller')).toBeNull()
  })
  it('is never produced by the address builders', () => {
    for (const a of [buildListenerAddress(0), buildListenerAddress(9000, 'supersecret1'), buildRelayAddress(), buildRelayAddress('x y z 12345', 'eu-north'),
      relayAddressPatch({ storedDirection: 'relay', storedRelay: 'eu-north', relay: 'default', passphrase: '' })!]) {
      expect(bareQueryKey(a)).toBeNull()
    }
  })
})

describe('isRendezvousAddress', () => {
  it('reads mode=rendezvous only', () => {
    expect(isRendezvousAddress('srt://h:1?mode=rendezvous')).toBe(true)
    expect(isRendezvousAddress('srt://h:1?latency=1&mode=rendezvous&x=1')).toBe(true)
    expect(isRendezvousAddress('srt://h:1?mode=caller')).toBe(false)
    expect(isRendezvousAddress('srt://h:1?mode=rendezvousx')).toBe(false)
  })
})

function caps(over: Partial<SrtCapabilities> = {}): SrtCapabilities {
  return {
    state: 'ok',
    modes: { listener: true, caller: true, rendezvous: true },
    relays: [],
    inboundReachable: true,
    ports: null,
    ...over,
  }
}
const DEFAULT_RELAY_EP = { name: 'default', public: 'srt.example.com:9000' }
const EU_RELAY = { name: 'eu-north', public: 'eu.example.com:9000' }
const CLOSED = { listener: false, caller: true, rendezvous: false }

describe('srtOffer', () => {
  it('offers every mode and no relay on an older backend without srt', () => {
    const o = srtOffer(undefined)
    expect(o).toMatchObject({ state: 'unknown', listener: true, rendezvous: true, relays: [], relayPicker: false, note: null })
  })

  it('hides listener and rendezvous only when Strom answered (state ok) that they cannot work', () => {
    const o = srtOffer(caps({ modes: CLOSED, inboundReachable: false, relays: [DEFAULT_RELAY_EP] }))
    expect(o.listener).toBe(false)
    expect(o.rendezvous).toBe(false)
    expect(o.note).toEqual({ kind: 'blocked', text: 'This Strom cannot be reached from outside; use caller or Via relay.' })
    expect(srtOffer(caps({ modes: CLOSED })).note?.text).toBe('This Strom cannot be reached from outside; use caller.')
  })

  it('keeps everything offered while the state is unknown, unreachable or unsupported', () => {
    for (const state of ['unknown', 'unreachable', 'unsupported'] as const) {
      const o = srtOffer(caps({ state, modes: CLOSED }))
      expect(o.listener).toBe(true)
      expect(o.rendezvous).toBe(true)
    }
    expect(srtOffer(caps({ state: 'unreachable', modes: CLOSED })).note?.kind).toBe('unreachable')
    expect(srtOffer(caps({ state: 'unknown' })).note).toBeNull()
    expect(srtOffer(caps({ state: 'unsupported' })).note).toBeNull()
  })

  it('shows the relay picker for more than one relay, or one not named default', () => {
    expect(srtOffer(caps({ relays: [] })).relayPicker).toBe(false)
    expect(srtOffer(caps({ relays: [DEFAULT_RELAY_EP] })).relayPicker).toBe(false)
    expect(srtOffer(caps({ relays: [EU_RELAY] })).relayPicker).toBe(true)
    expect(srtOffer(caps({ relays: [DEFAULT_RELAY_EP, EU_RELAY] })).relayPicker).toBe(true)
  })
})

describe('offeredDirection', () => {
  const closed = srtOffer(caps({ modes: CLOSED, relays: [DEFAULT_RELAY_EP] }))
  it('falls back to caller for a listener Strom cannot do, unless it is stored', () => {
    expect(offeredDirection('listener', closed)).toBe('caller')
    expect(offeredDirection('listener', closed, 'listener')).toBe('listener')
    expect(offeredDirection('relay', closed)).toBe('relay')
  })
  it('falls back from relay when there is none', () => {
    expect(offeredDirection('relay', srtOffer(caps()))).toBe('listener')
    expect(offeredDirection('relay', srtOffer(caps({ modes: CLOSED })))).toBe('caller')
    expect(offeredDirection('relay', srtOffer(caps()), 'relay')).toBe('relay')
  })
})

describe('rendezvousError', () => {
  const closed = srtOffer(caps({ modes: CLOSED, relays: [DEFAULT_RELAY_EP] }))
  it('refuses a new rendezvous address when Strom says it cannot work', () => {
    expect(rendezvousError('srt://h:1?mode=rendezvous', closed)).toBe('Rendezvous will not work here. This Strom cannot be reached from outside; use caller or Via relay.')
  })
  it('accepts it when Strom can, when it is the stored one, and any caller address', () => {
    expect(rendezvousError('srt://h:1?mode=rendezvous', srtOffer(caps()))).toBeNull()
    expect(rendezvousError('srt://h:1?mode=rendezvous', srtOffer(caps({ state: 'unreachable', modes: CLOSED })))).toBeNull()
    expect(rendezvousError('srt://h:1?mode=rendezvous', closed, 'srt://h:1?mode=rendezvous')).toBeNull()
    expect(rendezvousError('srt://h:1?mode=caller', closed)).toBeNull()
  })
})

describe('srtConnectWarningText', () => {
  const connect: SrtConnect = { uri: 'srt://strom:1?mode=caller', host: 'strom', port: 1, mode: 'caller', source: 'strom-host' }
  it('explains a listener or rendezvous address that will not work', () => {
    expect(srtConnectWarningText({ ...connect, warning: 'srt-listener-unsupported' })).toMatch(/cannot be reached from outside, so this listener address will not work/)
    expect(srtConnectWarningText({ ...connect, warning: 'srt-rendezvous-unsupported' })).toMatch(/rendezvous address will not work/)
    expect(srtConnectWarningText({ ...connect, warning: 'srt-something-new' })).toMatch(/will not work here/)
  })
  it('explains a listener port outside Strom\'s ports', () => {
    expect(srtConnectWarningText({ ...connect, warning: 'srt-port-outside-strom-ports' })).toMatch(/outside the ports Strom is set up for \(STROM_PORTS\)/)
  })
  it('says nothing without a warning', () => {
    expect(srtConnectWarningText(connect)).toBeNull()
    expect(srtConnectWarningText(undefined)).toBeNull()
  })
})

describe('srtSaveErrorMessage', () => {
  it('names the configured relays for 422 srt-relay-unknown', () => {
    const err = new ApiError('Strom has no SRT relay named "x"; configured: default, eu-north', 422, {
      error: 'Strom has no SRT relay named "x"; configured: default, eu-north', statusCode: 422, code: 'srt-relay-unknown', relays: ['default', 'eu-north'],
    })
    expect(srtSaveErrorMessage(err, { listener: true })).toBe('Strom has no SRT relay of that name. Configured relays: default, eu-north. Pick one of them.')
  })
  it('explains 422 srt-relay-not-configured: listener or caller when Listener is offered', () => {
    const err = new ApiError('no relay', 422, { error: 'no relay', statusCode: 422, code: 'srt-relay-not-configured', relays: [] })
    expect(srtSaveErrorMessage(err, { listener: true })).toBe('Strom reports no SRT relay, so "Via relay" cannot be used here. Choose listener or caller.')
  })
  it('explains 422 srt-relay-not-configured: only caller when Strom cannot be reached from outside', () => {
    const err = new ApiError('no relay', 422, { error: 'no relay', statusCode: 422, code: 'srt-relay-not-configured', relays: [] })
    const text = srtSaveErrorMessage(err, { listener: false })
    expect(text).toBe('Strom reports no SRT relay, so "Via relay" cannot be used here. This Strom cannot be reached from outside; use caller.')
    expect(text).not.toMatch(/listener/i)
  })
  it('rewords the 400 for a query key without a value', () => {
    const msg = "SRT parameter 'latency' has no value, which crashes GStreamer: write 'latency=<value>' or remove it"
    expect(srtSaveErrorMessage(new ApiError(msg, 400, { error: msg, statusCode: 400 }), { listener: true })).toBe(bareQueryKeyError('srt://h:1?latency'))
  })
  it('leaves other errors to the general message', () => {
    expect(srtSaveErrorMessage(new ApiError('Port 47100 is outside', 422, { error: 'Port 47100 is outside', statusCode: 422 }), { listener: true })).toBeNull()
    expect(srtSaveErrorMessage(new ApiError('Invalid SRT relay name after "@"', 400), { listener: true })).toBeNull()
    expect(srtSaveErrorMessage(new Error('boom'), { listener: true })).toBeNull()
  })
})

describe('passphraseError', () => {
  it('accepts none, or 10–80 UTF-8 bytes counted before URL encoding', () => {
    expect(passphraseError('')).toBeNull()
    expect(passphraseError('   ')).toBeNull()
    expect(passphraseError('a'.repeat(10))).toBeNull()
    expect(passphraseError('a'.repeat(80))).toBeNull()
    // 10 raw characters that encode to more: still fine.
    expect(passphraseError('&&&&&&&&&&')).toBeNull()
  })
  it('refuses shorter or longer ones with a clear message', () => {
    expect(passphraseError('short')).toBe('The passphrase must be 10–80 bytes (it is 5; letters such as å count as 2).')
    expect(passphraseError('a'.repeat(81))).toMatch(/10–80 bytes \(it is 81;/)
    // 45 × å is 45 UTF-16 units but 90 bytes, which Strom refuses.
    expect(passphraseError('å'.repeat(45))).toMatch(/it is 90;/)
    expect(passphraseError('å'.repeat(39))).toBeNull()
  })
})

describe('Strom port spans', () => {
  const spans = [{ first: 48000, last: 48000 }, { first: 47100, last: 47102 }]
  it('portInSpans checks every span, inclusive', () => {
    expect(portInSpans(47100, spans)).toBe(true)
    expect(portInSpans(47102, spans)).toBe(true)
    expect(portInSpans(48000, spans)).toBe(true)
    expect(portInSpans(47103, spans)).toBe(false)
    expect(portInSpans(9000, [])).toBe(false)
  })
  it('freePortsInSpans lists the lowest unused ports first, up to the limit', () => {
    expect(freePortsInSpans(spans, [47100, 47102], 10)).toEqual([47101, 48000])
    expect(freePortsInSpans(spans, [], 2)).toEqual([47100, 47101])
    expect(freePortsInSpans(spans, [47100, 47101, 47102, 48000], 10)).toEqual([])
  })
  it('describeSpans reads as ranges, lowest first', () => {
    expect(describeSpans(spans)).toBe('47100\u201347102, 48000')
  })
})
