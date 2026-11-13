// @vitest-environment jsdom
/**
 * SRT relay sources (open-live srt+relay://): "Via relay" is offered when the
 * backend reports a configured relay, submits `srt+relay://auto` (+ passphrase),
 * and the row shows the backend's dial-in address, never the passphrase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { gatewaysApi, serverInfoApi, sourcesApi, type ApiSource } from '@/lib/api'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { SourcesPanel } from './SourcesPanel'

const RELAY_CAM: ApiSource = {
  id: 'cam-relay',
  name: 'Relay cam',
  address: 'srt+relay://AbCdEfGhIjKlMnOpQrStUv?passphrase=***',
  streamType: 'srt',
  status: 'inactive',
  connect: {
    uri: 'srt://relay.example.com:9000?streamid=AbCdEfGhIjKlMnOpQrStUv',
    host: 'relay.example.com',
    port: 9000,
    mode: 'caller',
    source: 'srt-relay',
    streamid: 'AbCdEfGhIjKlMnOpQrStUv',
  },
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.spyOn(sourcesApi, 'list').mockResolvedValue([RELAY_CAM])
  vi.spyOn(sourcesApi, 'audioStreams').mockResolvedValue({ discovery: 'unavailable', reason: 'no-live-flow', streams: [] } as never)
  vi.spyOn(gatewaysApi, 'list').mockResolvedValue([])
  vi.spyOn(serverInfoApi, 'get').mockResolvedValue({
    stromHost: 'strom.example.com',
    srtPorts: [47100],
    srtPortState: 'reserved',
    srt: { state: 'ok', modes: { listener: true, caller: true, rendezvous: true }, relays: [{ name: 'default', public: 'relay.example.com:9000' }], inboundReachable: true, ports: null },
  })
  useSourcesStore.setState({ sources: [], isLoading: false, lastFetchedAt: Date.now() })
  useProductionsStore.setState({ productions: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

describe('SourcesPanel — SRT relay', () => {
  it('shows the relay dial-in address from the backend', async () => {
    render(<SourcesPanel />)
    expect(
      await screen.findByText('sender dials srt://relay.example.com:9000?streamid=AbCdEfGhIjKlMnOpQrStUv with the passphrase'),
    ).toBeTruthy()
  })

  it('New Source "Via relay" submits srt+relay://auto with the passphrase', async () => {
    const create = vi.spyOn(sourcesApi, 'create').mockResolvedValue({ ...RELAY_CAM, id: 'new', name: 'Cam 2' })
    render(<SourcesPanel />)
    await screen.findByText('Relay cam')
    fireEvent.click(screen.getByRole('button', { name: '+ New Source' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Via relay (one public port)' }))
    expect(screen.getByText(/The relay port is public/)).toBeTruthy()
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Cam 2' } })
    fireEvent.change(screen.getByPlaceholderText('None'), { target: { value: 'supersecretpass' } })
    save()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0]?.[0]).toMatchObject({ address: 'srt+relay://auto?passphrase=supersecretpass', streamType: 'srt' })
  })

  it('Edit leaves a relay address alone without a new passphrase', async () => {
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(RELAY_CAM)
    render(<SourcesPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByText('Edit Source')
    expect(screen.getByText(/stays the same when you save/)).toBeTruthy()
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Renamed' } })
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('address')
  })

  it('Edit with a new passphrase sends auto, so the backend keeps the stream ID', async () => {
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(RELAY_CAM)
    render(<SourcesPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByText('Edit Source')
    fireEvent.change(screen.getByPlaceholderText('Set — leave blank to keep'), { target: { value: 'anothersecret' } })
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ address: 'srt+relay://auto?passphrase=anothersecret' })
  })

  it('"Remove passphrase" on the same relay sends auto?passphrase=, which removes it', async () => {
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(RELAY_CAM)
    render(<SourcesPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByText('Edit Source')
    fireEvent.click(screen.getByRole('button', { name: 'Remove passphrase' }))
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ address: 'srt+relay://auto?passphrase=' })
  })

  it('switching a relay source with a passphrase to Listener does not claim to keep it', async () => {
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(RELAY_CAM)
    render(<SourcesPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByText('Edit Source')
    fireEvent.click(screen.getByRole('button', { name: 'Listener' }))
    expect(screen.queryByPlaceholderText('Set — leave blank to keep')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('None'), { target: { value: 'newlistenersecret' } })
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ address: 'srt://:0?mode=listener&passphrase=newlistenersecret' })
  })

  it('refuses a relay passphrase outside 10–80 bytes', async () => {
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(RELAY_CAM)
    render(<SourcesPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByText('Edit Source')
    fireEvent.change(screen.getByPlaceholderText('Set — leave blank to keep'), { target: { value: 'x'.repeat(81) } })
    save()
    expect(await screen.findByText('The passphrase must be 10–80 bytes (it is 81; letters such as å count as 2).')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })

  it('a relay row says Strom is not answering when the relay status is unavailable', async () => {
    vi.spyOn(sourcesApi, 'list').mockResolvedValue([
      { ...RELAY_CAM, connect: { ...RELAY_CAM.connect!, uri: null, host: null, port: null, reason: 'srt-relay-unreachable' } },
    ])
    render(<SourcesPanel />)
    expect(await screen.findByText(/via relay · stream ID AbCdEfGhIjKlMnOpQrStUv · relay status unavailable, Strom is not answering/)).toBeTruthy()
  })
})
