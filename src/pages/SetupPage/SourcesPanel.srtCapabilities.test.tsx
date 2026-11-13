// @vitest-environment jsdom
/**
 * SRT sources against server-info `srt` (open-live#628, named relays): only the
 * directions Strom can do are offered, the relay picker follows the relay list,
 * `auto@<relay>` is written on create and on a relay switch (which keeps the
 * stored passphrase unless one is typed or removed), `connect.warning` is
 * shown, and the relay/query-key errors read as operator messages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError, gatewaysApi, sourcesApi, type ApiSource, type ServerInfo, type SrtCapabilities } from '@/lib/api'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { SourcesPanel } from './SourcesPanel'

let mockInfo: ServerInfo | null = null
vi.mock('@/hooks/useServerInfo', () => ({ refreshServerInfo: async () => {}, useServerInfo: () => ({ info: mockInfo, loaded: true }) }))

const DEFAULT_RELAY = { name: 'default', public: 'srt.example.com:9000' }
const EU_RELAY = { name: 'eu-north', public: 'eu.example.com:9000' }
const OPEN = { listener: true, caller: true, rendezvous: true }
const CLOSED = { listener: false, caller: true, rendezvous: false }

function withSrt(srt: Partial<SrtCapabilities>): void {
  mockInfo = {
    stromHost: 'strom.example.com',
    srtPorts: [47100],
    srtPortState: 'reserved',
    srt: { state: 'ok', modes: OPEN, relays: [], inboundReachable: true, ports: null, ...srt },
  }
}

const CAM: ApiSource = {
  id: 'cam-1',
  name: 'Cam 1',
  address: 'srt://sender.example.com:9000?mode=caller',
  streamType: 'srt',
  status: 'inactive',
}

const RELAY_CAM: ApiSource = {
  id: 'cam-relay',
  name: 'Relay cam',
  address: 'srt+relay://AbCdEfGhIjKlMnOpQrStUv@eu-north?passphrase=***',
  streamType: 'srt',
  status: 'inactive',
  connect: {
    uri: 'srt://eu.example.com:9000?streamid=AbCdEfGhIjKlMnOpQrStUv',
    host: 'eu.example.com',
    port: 9000,
    mode: 'caller',
    source: 'srt-relay',
    streamid: 'AbCdEfGhIjKlMnOpQrStUv',
    relay: 'eu-north',
  },
}

const LISTENER_CAM: ApiSource = {
  id: 'cam-listener',
  name: 'Listener cam',
  address: 'srt://:47100?mode=listener',
  streamType: 'srt',
  status: 'inactive',
  connect: {
    uri: 'srt://strom.example.com:47100?mode=caller',
    host: 'strom.example.com',
    port: 47100,
    mode: 'caller',
    source: 'strom-host',
    warning: 'srt-listener-unsupported',
  },
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.spyOn(sourcesApi, 'list').mockResolvedValue([CAM])
  vi.spyOn(sourcesApi, 'audioStreams').mockResolvedValue({ discovery: 'unavailable', reason: 'no-live-flow', streams: [] } as never)
  vi.spyOn(gatewaysApi, 'list').mockResolvedValue([])
  withSrt({})
  useSourcesStore.setState({ sources: [], isLoading: false, lastFetchedAt: Date.now() })
  useProductionsStore.setState({ productions: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
const RELAY = 'Via relay (one public port)'
const BLOCKED = 'This Strom cannot be reached from outside; use caller or Via relay.'

async function openNew(): Promise<void> {
  render(<SourcesPanel />)
  await screen.findByText(/Cam 1|Relay cam|Listener cam/)
  fireEvent.click(screen.getByRole('button', { name: '+ New Source' }))
  await screen.findByRole('button', { name: 'Listener' })
  fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Cam 2' } })
}

async function openEdit(): Promise<void> {
  render(<SourcesPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  await screen.findByText('Edit Source')
}

describe('SourcesPanel — SRT directions Strom can do', () => {
  it('Strom unreachable from outside (state ok): Listener disabled with the reason, caller chosen', async () => {
    withSrt({ modes: CLOSED, inboundReachable: false, relays: [DEFAULT_RELAY] })
    await openNew()
    expect((screen.getByRole('button', { name: 'Listener' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(BLOCKED)).toBeTruthy()
    expect(screen.getByPlaceholderText('srt://sender.example.com:9000?mode=caller')).toBeTruthy()
    expect(screen.getByRole('button', { name: RELAY })).toBeTruthy()
  })

  it('without a relay the reason only points to caller, and Via relay is not offered', async () => {
    withSrt({ modes: CLOSED, inboundReachable: false })
    await openNew()
    expect(screen.getByText('This Strom cannot be reached from outside; use caller.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: RELAY })).toBeNull()
  })

  it.each(['unknown', 'unsupported'] as const)('state %s: every direction offered, no note', async (state) => {
    withSrt({ state, modes: CLOSED })
    await openNew()
    expect((screen.getByRole('button', { name: 'Listener' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(BLOCKED)).toBeNull()
    expect(screen.queryByText(/did not answer/)).toBeNull()
  })

  it('state unreachable: every direction offered, with a subtle note', async () => {
    withSrt({ state: 'unreachable', modes: CLOSED })
    await openNew()
    expect((screen.getByRole('button', { name: 'Listener' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText(/Strom did not answer the last check/)).toBeTruthy()
  })

  it('refuses a new rendezvous address when Strom says it cannot work', async () => {
    withSrt({ modes: CLOSED, relays: [DEFAULT_RELAY] })
    const create = vi.spyOn(sourcesApi, 'create').mockResolvedValue({ ...CAM, id: 'new' })
    await openNew()
    fireEvent.change(screen.getByPlaceholderText('srt://sender.example.com:9000?mode=caller'), { target: { value: 'srt://peer.example.com:9000?mode=rendezvous' } })
    save()
    expect(await screen.findByText(`Rendezvous will not work here. ${BLOCKED}`)).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('an existing listener shows connect.warning in the row and stays a listener in Edit', async () => {
    withSrt({ modes: CLOSED, relays: [DEFAULT_RELAY] })
    vi.spyOn(sourcesApi, 'list').mockResolvedValue([LISTENER_CAM])
    await openEdit()
    const warnings = screen.getAllByText(/so this listener address will not work/)
    expect(warnings.length).toBe(2) // the row and the dialog
    expect((screen.getByRole('button', { name: 'Listener' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('SourcesPanel — listener ports from Strom (STROM_PORTS)', () => {
  // No legacy reservation; Strom reports its STROM_PORTS as srt.ports.
  function withStromPorts(): void {
    withSrt({ ports: [{ first: 47100, last: 47102 }, { first: 48000, last: 48000 }] })
    mockInfo = { ...mockInfo!, srtPorts: null, srtPortState: 'unsupported' }
  }
  const USED_47100: ApiSource = { ...LISTENER_CAM, connect: undefined }

  it('offers the lowest port no listed source uses, and saves it when the field is left blank', async () => {
    withStromPorts()
    vi.spyOn(sourcesApi, 'list').mockResolvedValue([USED_47100])
    const create = vi.spyOn(sourcesApi, 'create').mockResolvedValue({ ...CAM, id: 'new' })
    await openNew()
    expect(screen.getByPlaceholderText('47101')).toBeTruthy()
    expect(screen.getByText('Strom is set up for ports 47100\u201347102, 48000. Leave blank to use 47101, the lowest one no listed source or output uses.')).toBeTruthy()
    const offered = [...document.querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value)
    expect(offered).toEqual(['47101', '47102', '48000'])
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ address: 'srt://:47101?mode=listener' })
  })

  it('a typed port inside the spans saves without a warning', async () => {
    withStromPorts()
    const create = vi.spyOn(sourcesApi, 'create').mockResolvedValue({ ...CAM, id: 'new' })
    await openNew()
    fireEvent.change(screen.getByPlaceholderText('47100'), { target: { value: '48000' } })
    expect(screen.queryByText(/is outside the ports Strom is set up for/)).toBeNull()
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ address: 'srt://:48000?mode=listener' })
  })

  it('a typed port outside the spans warns inline and is still saved', async () => {
    withStromPorts()
    const create = vi.spyOn(sourcesApi, 'create').mockResolvedValue({ ...CAM, id: 'new' })
    await openNew()
    fireEvent.change(screen.getByPlaceholderText('47100'), { target: { value: '9000' } })
    expect(screen.getByText('Port 9000 is outside the ports Strom is set up for (47100\u201347102, 48000), so senders may not reach it. It is saved anyway.')).toBeTruthy()
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ address: 'srt://:9000?mode=listener' })
  })

  it('the legacy reservation still wins over srt.ports', async () => {
    withSrt({ ports: [{ first: 47100, last: 47102 }] })
    await openNew()
    expect(screen.getByText(/Assigned on save from this instance.s ports 47100\./)).toBeTruthy()
    expect(screen.queryByText(/Strom is set up for ports/)).toBeNull()
  })

  it('connect.warning srt-port-outside-strom-ports shows in the row and in Edit', async () => {
    withStromPorts()
    vi.spyOn(sourcesApi, 'list').mockResolvedValue([
      { ...LISTENER_CAM, address: 'srt://:9000?mode=listener', connect: { ...LISTENER_CAM.connect!, port: 9000, warning: 'srt-port-outside-strom-ports' } },
    ])
    await openEdit()
    expect(screen.getAllByText(/This listener port is outside the ports Strom is set up for \(STROM_PORTS\)/).length).toBe(2)
  })
})

describe('SourcesPanel — relay picker', () => {
  it('one relay named default: no picker, auto without @', async () => {
    withSrt({ relays: [DEFAULT_RELAY] })
    const create = vi.spyOn(sourcesApi, 'create').mockResolvedValue({ ...CAM, id: 'new' })
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: RELAY }))
    expect(screen.queryByLabelText('Relay')).toBeNull()
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ address: 'srt+relay://auto' })
  })

  it('one relay not named default: picker shown, auto@<name>', async () => {
    withSrt({ relays: [EU_RELAY] })
    const create = vi.spyOn(sourcesApi, 'create').mockResolvedValue({ ...CAM, id: 'new' })
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: RELAY }))
    expect((screen.getByLabelText('Relay') as HTMLSelectElement).value).toBe('eu-north')
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ address: 'srt+relay://auto@eu-north' })
  })

  it('several relays: default first and preselected; picking one writes auto@<name>', async () => {
    withSrt({ relays: [DEFAULT_RELAY, EU_RELAY] })
    const create = vi.spyOn(sourcesApi, 'create').mockResolvedValue({ ...CAM, id: 'new' })
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: RELAY }))
    const picker = screen.getByLabelText('Relay') as HTMLSelectElement
    expect(picker.value).toBe('default')
    expect([...picker.options].map((o) => o.textContent)).toEqual(['default (srt.example.com:9000)', 'eu-north (eu.example.com:9000)'])
    fireEvent.change(picker, { target: { value: 'eu-north' } })
    fireEvent.change(screen.getByPlaceholderText('None'), { target: { value: 'supersecretpass' } })
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ address: 'srt+relay://auto@eu-north?passphrase=supersecretpass' })
  })

  it('Edit on the stored relay: shows its dial-in address; a new passphrase sends auto without @', async () => {
    withSrt({ relays: [DEFAULT_RELAY, EU_RELAY] })
    vi.spyOn(sourcesApi, 'list').mockResolvedValue([RELAY_CAM])
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(RELAY_CAM)
    await openEdit()
    expect((screen.getByLabelText('Relay') as HTMLSelectElement).value).toBe('eu-north')
    expect(screen.getByText('The sender dials srt://eu.example.com:9000?streamid=AbCdEfGhIjKlMnOpQrStUv with the passphrase')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Set — leave blank to keep'), { target: { value: 'anothersecret' } })
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ address: 'srt+relay://auto?passphrase=anothersecret' })
  })

  it('Edit switching back to the default relay with a blank passphrase sends auto@default and keeps the passphrase', async () => {
    withSrt({ relays: [DEFAULT_RELAY, EU_RELAY] })
    vi.spyOn(sourcesApi, 'list').mockResolvedValue([RELAY_CAM])
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(RELAY_CAM)
    await openEdit()
    fireEvent.change(screen.getByLabelText('Relay'), { target: { value: 'default' } })
    expect(screen.getByText(/Moves to the default relay on save; the stream ID and the passphrase stay the same. The sender then dials srt.example.com:9000 instead./)).toBeTruthy()
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ address: 'srt+relay://auto@default' })
  })

  it('Edit switching relay with a new passphrase sends it', async () => {
    withSrt({ relays: [DEFAULT_RELAY, EU_RELAY] })
    vi.spyOn(sourcesApi, 'list').mockResolvedValue([RELAY_CAM])
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(RELAY_CAM)
    await openEdit()
    fireEvent.change(screen.getByLabelText('Relay'), { target: { value: 'default' } })
    fireEvent.change(screen.getByPlaceholderText('Set — leave blank to keep'), { target: { value: 'anothersecret' } })
    expect(screen.getByText(/Moves to the default relay on save; the stream ID stays the same./)).toBeTruthy()
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ address: 'srt+relay://auto@default?passphrase=anothersecret' })
  })

  it('Edit switching relay with "Remove passphrase" sends auto@default?passphrase=', async () => {
    withSrt({ relays: [DEFAULT_RELAY, EU_RELAY] })
    vi.spyOn(sourcesApi, 'list').mockResolvedValue([RELAY_CAM])
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(RELAY_CAM)
    await openEdit()
    fireEvent.change(screen.getByLabelText('Relay'), { target: { value: 'default' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove passphrase' }))
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ address: 'srt+relay://auto@default?passphrase=' })
  })

  it('a stored relay Strom no longer has: row says so with the configured relays, picker keeps it', async () => {
    withSrt({ relays: [DEFAULT_RELAY] })
    vi.spyOn(sourcesApi, 'list').mockResolvedValue([
      { ...RELAY_CAM, connect: { ...RELAY_CAM.connect!, uri: null, host: null, port: null, reason: 'srt-relay-unknown' } },
    ])
    await openEdit()
    expect(screen.getByText(
      'via relay eu-north · stream ID AbCdEfGhIjKlMnOpQrStUv · Strom has no SRT relay named "eu-north" (configured: default); edit it and pick another relay',
    )).toBeTruthy()
    const picker = screen.getByLabelText('Relay') as HTMLSelectElement
    expect(picker.value).toBe('eu-north')
    expect([...picker.options].map((o) => o.textContent)).toContain('eu-north (not reported by Strom)')
  })
})

describe('SourcesPanel — SRT save errors', () => {
  it('shows a 422 srt-relay-unknown on create with the configured relays, keeping the dialog open', async () => {
    withSrt({ relays: [DEFAULT_RELAY, EU_RELAY] })
    vi.spyOn(sourcesApi, 'create').mockRejectedValue(new ApiError('Strom has no SRT relay named "eu-north"; configured: default', 422, {
      error: 'Strom has no SRT relay named "eu-north"; configured: default', statusCode: 422, code: 'srt-relay-unknown', relays: ['default'],
    }))
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: RELAY }))
    fireEvent.change(screen.getByLabelText('Relay'), { target: { value: 'eu-north' } })
    save()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Strom has no SRT relay of that name. Configured relays: default. Pick one of them.')
    expect(screen.getByText('New Source')).toBeTruthy()
  })

  it('shows a 422 srt-relay-not-configured on edit', async () => {
    withSrt({ relays: [DEFAULT_RELAY] })
    vi.spyOn(sourcesApi, 'update').mockRejectedValue(new ApiError('no relay', 422, { error: 'no relay', statusCode: 422, code: 'srt-relay-not-configured', relays: [] }))
    await openEdit()
    fireEvent.click(screen.getByRole('button', { name: RELAY }))
    save()
    expect(await screen.findByText('Strom reports no SRT relay, so "Via relay" cannot be used here. Choose listener or caller.')).toBeTruthy()
  })

  it('a 422 srt-relay-not-configured on a Strom that cannot be reached from outside points to caller only', async () => {
    withSrt({ modes: CLOSED, inboundReachable: false, relays: [DEFAULT_RELAY] })
    vi.spyOn(sourcesApi, 'update').mockRejectedValue(new ApiError('no relay', 422, { error: 'no relay', statusCode: 422, code: 'srt-relay-not-configured', relays: [] }))
    await openEdit()
    fireEvent.click(screen.getByRole('button', { name: RELAY }))
    save()
    expect(await screen.findByText('Strom reports no SRT relay, so "Via relay" cannot be used here. This Strom cannot be reached from outside; use caller.')).toBeTruthy()
  })

  it('refuses a caller address with a query key without a value before sending it', async () => {
    const create = vi.spyOn(sourcesApi, 'create').mockResolvedValue({ ...CAM, id: 'new' })
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: 'Caller' }))
    fireEvent.change(screen.getByPlaceholderText('srt://sender.example.com:9000?mode=caller'), { target: { value: 'srt://peer.example.com:9000?latency' } })
    save()
    expect(await screen.findByText('The SRT parameter "latency" has no value, which crashes GStreamer. Write latency=<value>, or remove it.')).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('shows the backend 400 for a query key without a value as the same message', async () => {
    const msg = "SRT parameter 'latency' has no value, which crashes GStreamer: write 'latency=<value>' or remove it"
    vi.spyOn(sourcesApi, 'update').mockRejectedValue(new ApiError(msg, 400, { error: msg, statusCode: 400 }))
    await openEdit()
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Renamed' } })
    save()
    expect(await screen.findByText('The SRT parameter "latency" has no value, which crashes GStreamer. Write latency=<value>, or remove it.')).toBeTruthy()
  })
})
