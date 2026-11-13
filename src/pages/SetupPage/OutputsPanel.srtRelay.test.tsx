// @vitest-environment jsdom
/**
 * SRT relay outputs on a backend whose Strom has NO relay configured: the
 * "Via relay" choice is not offered for new outputs and the listener flow is
 * unchanged, while an existing relay output still shows (and keeps) its relay
 * choice, with its dial-in address from the backend's `connect`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { outputsApi, serverInfoApi, storageConnectionsApi, type ApiOutput } from '@/lib/api'
import { useOutputsStore } from '@/store/outputs.store'
import { useProductionsStore } from '@/store/productions.store'
import { OutputsPanel } from './OutputsPanel'

const RELAY_OUT: ApiOutput = {
  id: 'out-relay',
  name: 'Relay PGM',
  outputType: 'mpegtssrt',
  url: 'srt+relay://pgm_sticky',
  connect: { uri: null, host: null, port: null, mode: 'caller', source: 'srt-relay', streamid: 'pgm_sticky', reason: 'srt-relay-not-configured' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const LISTENER_OUT: ApiOutput = {
  id: 'out-listener',
  name: 'Listener PGM',
  outputType: 'mpegtssrt',
  url: 'srt://:47101?mode=listener&passphrase=***',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.spyOn(outputsApi, 'list').mockResolvedValue([RELAY_OUT, LISTENER_OUT])
  vi.spyOn(storageConnectionsApi, 'list').mockResolvedValue([])
  vi.spyOn(serverInfoApi, 'get').mockResolvedValue({
    stromHost: 'strom.example.com',
    srtPorts: [47100, 47101],
    srtPortState: 'reserved',
    srt: { state: 'ok', modes: { listener: true, caller: true, rendezvous: true }, relays: [], inboundReachable: true, ports: null },
  })
  useOutputsStore.setState({ outputs: [], isLoading: false, lastFetchedAt: Date.now() })
  useProductionsStore.setState({ productions: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OutputsPanel — SRT relay not configured', () => {
  it('a listener output still shows the Strom-host viewer address', async () => {
    render(<OutputsPanel />)
    expect(await screen.findByText('viewers dial srt://strom.example.com:47101?mode=caller with the passphrase')).toBeTruthy()
  })

  it('a relay output without a dial-in address says why, instead of a guessed address', async () => {
    render(<OutputsPanel />)
    expect(await screen.findByText('via relay · stream ID pgm_sticky · Strom reports no SRT relay')).toBeTruthy()
  })

  it('says the relay status is unavailable when Strom is not answering', async () => {
    vi.spyOn(outputsApi, 'list').mockResolvedValue([
      { ...RELAY_OUT, connect: { ...RELAY_OUT.connect!, reason: 'srt-relay-unreachable' } },
    ])
    render(<OutputsPanel />)
    expect(await screen.findByText('via relay · stream ID pgm_sticky · relay status unavailable, Strom is not answering')).toBeTruthy()
  })

  it('a listener output uses the backend dial-in address (SRT_PUBLIC_HOST), not the Strom host', async () => {
    vi.spyOn(outputsApi, 'list').mockResolvedValue([
      {
        ...LISTENER_OUT,
        connect: { uri: 'srt://srt.example.com:47101?mode=caller', host: 'srt.example.com', port: 47101, mode: 'caller', source: 'srt-public-host' },
      },
    ])
    render(<OutputsPanel />)
    expect(await screen.findByText('viewers dial srt://srt.example.com:47101?mode=caller with the passphrase')).toBeTruthy()
  })

  it('New Output offers no relay choice and builds a listener address as before', async () => {
    const create = vi.spyOn(outputsApi, 'create').mockResolvedValue({ ...LISTENER_OUT, id: 'new' })
    render(<OutputsPanel />)
    await screen.findByText('Relay PGM')
    fireEvent.click(screen.getByRole('button', { name: '+ New Output' }))
    await screen.findByRole('button', { name: 'Listener' })
    expect(screen.queryByRole('button', { name: 'Via relay (one public port)' })).toBeNull()
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Out 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ outputType: 'mpegtssrt', url: 'srt://:0?mode=listener' })
  })

  it('editing an existing relay output keeps the relay choice', async () => {
    render(<OutputsPanel />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    await screen.findByText('Edit Output')
    expect(screen.getByRole('button', { name: 'Via relay (one public port)' })).toBeTruthy()
    expect(screen.getByText('The relay dial-in address is not known: Strom reports no SRT relay.')).toBeTruthy()
  })

  it('switching a relay output with a passphrase to Listener does not claim to keep the passphrase', async () => {
    vi.spyOn(outputsApi, 'list').mockResolvedValue([{ ...RELAY_OUT, url: 'srt+relay://pgm_sticky?passphrase=***' }])
    const update = vi.spyOn(outputsApi, 'update').mockResolvedValue({ ...LISTENER_OUT })
    render(<OutputsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByText('Edit Output')
    expect(screen.getByPlaceholderText('Set — leave blank to keep')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Listener' }))
    expect(screen.queryByPlaceholderText('Set — leave blank to keep')).toBeNull()
    expect(screen.getByPlaceholderText('None')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ url: 'srt://:0?mode=listener' })
  })

  it('refuses a passphrase outside 10–80 bytes with a clear message', async () => {
    const create = vi.spyOn(outputsApi, 'create').mockResolvedValue({ ...LISTENER_OUT, id: 'new' })
    render(<OutputsPanel />)
    await screen.findByText('Relay PGM')
    fireEvent.click(screen.getByRole('button', { name: '+ New Output' }))
    await screen.findByRole('button', { name: 'Listener' })
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Out 2' } })
    fireEvent.change(screen.getByPlaceholderText('None'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('The passphrase must be 10–80 bytes (it is 5; letters such as å count as 2).')).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })
})
