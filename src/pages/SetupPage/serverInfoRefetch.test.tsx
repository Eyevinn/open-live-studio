// @vitest-environment jsdom
/**
 * server-info `srt` carries live Strom state, so the New/Edit source and output
 * dialogs read it again when they open (open-live#628, spec §6). The backend
 * answers `state: unknown, relays: []` until its first capabilities check
 * succeeds; a dialog opened after that must offer "Via relay" without a reload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ServerInfo } from '@/lib/api'

const RELAY = 'Via relay (one public port)'
const OPEN = { listener: true, caller: true, rendezvous: true }

const UNKNOWN: ServerInfo = {
  stromHost: 'strom.example.com',
  srtPorts: [47100],
  srtPortState: 'reserved',
  srt: { state: 'unknown', modes: OPEN, relays: [], inboundReachable: null, ports: null },
}
const WITH_RELAY: ServerInfo = {
  ...UNKNOWN,
  srt: { state: 'ok', modes: OPEN, relays: [{ name: 'default', public: 'relay.example.com:9000' }], inboundReachable: true, ports: null },
}

beforeEach(() => {
  // Fresh module state per test: useServerInfo keeps one shared answer per page.
  vi.resetModules()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('server-info refetch when a dialog opens', () => {
  it('New Source: the first answer has no relay, the refetch on open offers Via relay', async () => {
    const api = await import('@/lib/api')
    const get = vi.spyOn(api.serverInfoApi, 'get').mockResolvedValueOnce(UNKNOWN).mockResolvedValue(WITH_RELAY)
    vi.spyOn(api.sourcesApi, 'list').mockResolvedValue([])
    vi.spyOn(api.gatewaysApi, 'list').mockResolvedValue([])
    const { SourcesPanel } = await import('./SourcesPanel')
    render(<SourcesPanel />)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '+ New Source' }))
    expect(await screen.findByRole('button', { name: RELAY })).toBeTruthy()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('Edit Output: the refetch on open offers Via relay', async () => {
    const api = await import('@/lib/api')
    const get = vi.spyOn(api.serverInfoApi, 'get').mockResolvedValueOnce(UNKNOWN).mockResolvedValue(WITH_RELAY)
    vi.spyOn(api.outputsApi, 'list').mockResolvedValue([{
      id: 'out-1',
      name: 'PGM',
      outputType: 'mpegtssrt',
      url: 'srt://cdn.example.com:9000?mode=caller',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }])
    vi.spyOn(api.storageConnectionsApi, 'list').mockResolvedValue([])
    const { OutputsPanel } = await import('./OutputsPanel')
    render(<OutputsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByText('Edit Output')
    expect(await screen.findByRole('button', { name: RELAY })).toBeTruthy()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('a failed refetch keeps the last answer', async () => {
    const api = await import('@/lib/api')
    vi.spyOn(api.serverInfoApi, 'get').mockResolvedValueOnce(WITH_RELAY).mockRejectedValue(new Error('backend restarting'))
    vi.spyOn(api.sourcesApi, 'list').mockResolvedValue([])
    vi.spyOn(api.gatewaysApi, 'list').mockResolvedValue([])
    const { refreshServerInfo } = await import('@/hooks/useServerInfo')
    const { SourcesPanel } = await import('./SourcesPanel')
    render(<SourcesPanel />)
    fireEvent.click(screen.getByRole('button', { name: '+ New Source' }))
    expect(await screen.findByRole('button', { name: RELAY })).toBeTruthy()
    await refreshServerInfo()
    expect(screen.getByRole('button', { name: RELAY })).toBeTruthy()
  })
})
