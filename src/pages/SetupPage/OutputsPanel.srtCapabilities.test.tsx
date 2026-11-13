// @vitest-environment jsdom
/**
 * SRT outputs against server-info `srt` (open-live#628, named relays): Listener
 * is offered only when Strom can do it, the relay picker writes `auto@<relay>`,
 * `connect.warning` is shown, and relay/query-key errors read as operator messages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError, outputsApi, storageConnectionsApi, type ApiOutput, type ServerInfo, type SrtCapabilities } from '@/lib/api'
import { useOutputsStore } from '@/store/outputs.store'
import { useProductionsStore } from '@/store/productions.store'
import { OutputsPanel } from './OutputsPanel'

let mockInfo: ServerInfo | null = null
vi.mock('@/hooks/useServerInfo', () => ({ useServerInfo: () => ({ info: mockInfo, loaded: true }) }))

const DEFAULT_RELAY = { name: 'default', public: 'srt.example.com:9000' }
const EU_RELAY = { name: 'eu-north', public: 'eu.example.com:9000' }
const CLOSED = { listener: false, caller: true, rendezvous: false }

function withSrt(srt: Partial<SrtCapabilities>): void {
  mockInfo = {
    stromHost: 'strom.example.com',
    srtPorts: [47100, 47101],
    srtPortState: 'reserved',
    srt: { state: 'ok', modes: { listener: true, caller: true, rendezvous: true }, relays: [], inboundReachable: true, ports: null, ...srt },
  }
}

const LISTENER_OUT: ApiOutput = {
  id: 'out-listener',
  name: 'Listener PGM',
  outputType: 'mpegtssrt',
  url: 'srt://:47101?mode=listener',
  connect: {
    uri: 'srt://strom.example.com:47101?mode=caller',
    host: 'strom.example.com',
    port: 47101,
    mode: 'caller',
    source: 'strom-host',
    warning: 'srt-listener-unsupported',
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const RELAY_OUT: ApiOutput = {
  id: 'out-relay',
  name: 'Relay PGM',
  outputType: 'mpegtssrt',
  url: 'srt+relay://pgm_sticky_id_0123456',
  connect: {
    uri: 'srt://srt.example.com:9000?streamid=pgm_sticky_id_0123456',
    host: 'srt.example.com',
    port: 9000,
    mode: 'caller',
    source: 'srt-relay',
    streamid: 'pgm_sticky_id_0123456',
    relay: 'default',
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.spyOn(outputsApi, 'list').mockResolvedValue([LISTENER_OUT])
  vi.spyOn(storageConnectionsApi, 'list').mockResolvedValue([])
  withSrt({})
  useOutputsStore.setState({ outputs: [], isLoading: false, lastFetchedAt: Date.now() })
  useProductionsStore.setState({ productions: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
const RELAY = 'Via relay (one public port)'

async function openNew(): Promise<void> {
  render(<OutputsPanel />)
  await screen.findByText(/Listener PGM|Relay PGM/)
  fireEvent.click(screen.getByRole('button', { name: '+ New Output' }))
  await screen.findByRole('button', { name: 'Listener' })
  fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Out 2' } })
}

async function openEdit(): Promise<void> {
  render(<OutputsPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  await screen.findByText('Edit Output')
}

describe('OutputsPanel — SRT directions Strom can do', () => {
  it('Strom unreachable from outside: Listener disabled with the reason, the caller field shown', async () => {
    withSrt({ modes: CLOSED, inboundReachable: false, relays: [DEFAULT_RELAY] })
    await openNew()
    expect((screen.getByRole('button', { name: 'Listener' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('This Strom cannot be reached from outside; use caller or Via relay.')).toBeTruthy()
    expect(screen.getByPlaceholderText('srt://cdn.example.com:9000?mode=caller')).toBeTruthy()
  })

  it('state unreachable keeps Listener offered with a subtle note', async () => {
    withSrt({ state: 'unreachable', modes: CLOSED })
    await openNew()
    expect((screen.getByRole('button', { name: 'Listener' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText(/Strom did not answer the last check/)).toBeTruthy()
  })

  it('an existing listener output shows connect.warning in the row', async () => {
    withSrt({ modes: CLOSED })
    render(<OutputsPanel />)
    expect(await screen.findByText(/so this listener address will not work/)).toBeTruthy()
  })

  it('refuses a new rendezvous destination when Strom says it cannot work', async () => {
    withSrt({ modes: CLOSED })
    const create = vi.spyOn(outputsApi, 'create').mockResolvedValue({ ...LISTENER_OUT, id: 'new' })
    await openNew()
    fireEvent.change(screen.getByPlaceholderText('srt://cdn.example.com:9000?mode=caller'), { target: { value: 'srt://peer.example.com:9000?mode=rendezvous' } })
    save()
    expect(await screen.findByText('Rendezvous will not work here. This Strom cannot be reached from outside; use caller.')).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('OutputsPanel — relay picker', () => {
  it('several relays: picking one writes auto@<name> on create', async () => {
    withSrt({ relays: [DEFAULT_RELAY, EU_RELAY] })
    const create = vi.spyOn(outputsApi, 'create').mockResolvedValue({ ...RELAY_OUT, id: 'new' })
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: RELAY }))
    fireEvent.change(screen.getByLabelText('Relay'), { target: { value: 'eu-north' } })
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ outputType: 'mpegtssrt', url: 'srt+relay://auto@eu-north' })
  })

  it('only the default relay: no picker, auto without @', async () => {
    withSrt({ relays: [DEFAULT_RELAY] })
    const create = vi.spyOn(outputsApi, 'create').mockResolvedValue({ ...RELAY_OUT, id: 'new' })
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: RELAY }))
    expect(screen.queryByLabelText('Relay')).toBeNull()
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ url: 'srt+relay://auto' })
  })

  it('Edit moving a relay output without a passphrase to another relay sends auto@<name>', async () => {
    withSrt({ relays: [DEFAULT_RELAY, EU_RELAY] })
    vi.spyOn(outputsApi, 'list').mockResolvedValue([RELAY_OUT])
    const update = vi.spyOn(outputsApi, 'update').mockResolvedValue(RELAY_OUT)
    await openEdit()
    expect(screen.getByText('Viewers dial srt://srt.example.com:9000?streamid=pgm_sticky_id_0123456')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Relay'), { target: { value: 'eu-north' } })
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ url: 'srt+relay://auto@eu-north' })
  })
})

describe('OutputsPanel — SRT save errors', () => {
  it('shows a 422 srt-relay-unknown on edit with the configured relays', async () => {
    withSrt({ relays: [DEFAULT_RELAY, EU_RELAY] })
    vi.spyOn(outputsApi, 'list').mockResolvedValue([RELAY_OUT])
    vi.spyOn(outputsApi, 'update').mockRejectedValue(new ApiError('nope', 422, {
      error: 'nope', statusCode: 422, code: 'srt-relay-unknown', relays: ['default', 'eu-north'],
    }))
    await openEdit()
    fireEvent.change(screen.getByLabelText('Relay'), { target: { value: 'eu-north' } })
    save()
    expect(await screen.findByText('Strom has no SRT relay of that name. Configured relays: default, eu-north. Pick one of them.')).toBeTruthy()
    expect(screen.getByText('Edit Output')).toBeTruthy()
  })

  it('refuses a destination with a query key without a value before sending it', async () => {
    const create = vi.spyOn(outputsApi, 'create').mockResolvedValue({ ...LISTENER_OUT, id: 'new' })
    await openNew()
    fireEvent.click(screen.getByRole('button', { name: 'Caller' }))
    fireEvent.change(screen.getByPlaceholderText('srt://cdn.example.com:9000?mode=caller'), { target: { value: 'srt://cdn.example.com:9000?latency' } })
    save()
    expect(await screen.findByText('The SRT parameter "latency" has no value, which crashes GStreamer. Write latency=<value>, or remove it.')).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('shows the backend 400 for a query key without a value readably', async () => {
    const msg = "SRT parameter 'latency' has no value, which crashes GStreamer: write 'latency=<value>' or remove it"
    vi.spyOn(outputsApi, 'create').mockRejectedValue(new ApiError(msg, 400, { error: msg, statusCode: 400 }))
    await openNew()
    save()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The SRT parameter "latency" has no value, which crashes GStreamer. Write latency=<value>, or remove it.')
  })
})
