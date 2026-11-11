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
    srtRelay: { configured: false, public: null },
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

  it('a relay output without a known relay address says so instead of a guessed address', async () => {
    render(<OutputsPanel />)
    expect(await screen.findByText('via relay · stream ID pgm_sticky · relay address not known')).toBeTruthy()
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
    expect(screen.getByText("The relay's public address is not known yet.")).toBeTruthy()
  })
})
