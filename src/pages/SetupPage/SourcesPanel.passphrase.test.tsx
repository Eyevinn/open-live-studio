// @vitest-environment jsdom
/**
 * Removing a stored SRT passphrase from the Edit Source dialog (studio#257). The
 * backend masks a stored passphrase as `passphrase=***`, keeps the stored address
 * when none is sent, and replaces it in full when one is: "Remove passphrase"
 * sends the address without `passphrase=`, an empty field sends no address.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { gatewaysApi, serverInfoApi, sourcesApi, type ApiSource } from '@/lib/api'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { SourcesPanel } from './SourcesPanel'

const LISTENER: ApiSource = {
  id: 'cam-1',
  name: 'Cam 1',
  address: 'srt://:9000?mode=listener&passphrase=***',
  streamType: 'srt',
  status: 'inactive',
  audioStreamIndex: 0,
}

const CALLER: ApiSource = {
  ...LISTENER,
  address: 'srt://sender.example.com:9000?mode=caller&passphrase=***',
}

function setup(source: ApiSource) {
  vi.spyOn(sourcesApi, 'list').mockResolvedValue([source])
  useSourcesStore.setState({ sources: [], isLoading: false, lastFetchedAt: Date.now() })
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.spyOn(sourcesApi, 'audioStreams').mockResolvedValue({ discovery: 'unavailable', reason: 'no-live-flow', streams: [] } as never)
  vi.spyOn(gatewaysApi, 'list').mockResolvedValue([])
  vi.spyOn(serverInfoApi, 'get').mockResolvedValue(null as never)
  useProductionsStore.setState({ productions: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openEdit() {
  render(<SourcesPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  await screen.findByText('Edit Source')
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('Edit Source passphrase (listener)', () => {
  it('"Remove passphrase" sends the address without a passphrase and the list shows none', async () => {
    setup(LISTENER)
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue({ ...LISTENER, address: 'srt://:9000?mode=listener' })
    await openEdit()
    expect(screen.getAllByText(/with the passphrase/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Remove passphrase' }))
    expect((screen.getByPlaceholderText('Removed on save') as HTMLInputElement).disabled).toBe(true)
    save()
    await waitFor(() => expect(screen.queryByText('Edit Source')).toBeNull())
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toMatchObject({ address: 'srt://:9000?mode=listener' })
    expect(screen.queryAllByText(/with the passphrase/)).toHaveLength(0)
  })

  it('keeps the stored passphrase when the field is left empty (no address sent)', async () => {
    setup(LISTENER)
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(LISTENER)
    await openEdit()
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('address')
  })

  it('"Undo" cancels the removal', async () => {
    setup(LISTENER)
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(LISTENER)
    await openEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Remove passphrase' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('address')
  })

  it('sends a newly typed passphrase', async () => {
    setup(LISTENER)
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(LISTENER)
    await openEdit()
    fireEvent.change(screen.getByPlaceholderText('Set — leave blank to keep'), { target: { value: 'new-secret-123' } })
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ address: 'srt://:9000?mode=listener&passphrase=new-secret-123' })
  })
})

describe('Edit Source passphrase (caller)', () => {
  it('"Remove passphrase" strips it from the address field and sends that', async () => {
    setup(CALLER)
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue({ ...CALLER, address: 'srt://sender.example.com:9000?mode=caller' })
    await openEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Remove passphrase' }))
    expect(screen.getByDisplayValue('srt://sender.example.com:9000?mode=caller')).toBeTruthy()
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ address: 'srt://sender.example.com:9000?mode=caller' })
  })

  it('blocks a changed address that still carries the masked passphrase', async () => {
    setup(CALLER)
    const update = vi.spyOn(sourcesApi, 'update')
    await openEdit()
    fireEvent.change(screen.getByDisplayValue(CALLER.address!), {
      target: { value: 'srt://other.example.com:9000?mode=caller&passphrase=***' },
    })
    save()
    expect(await screen.findByText(/The passphrase is hidden as \*\*\*/)).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })

  it('sends no address when the masked address is left unchanged', async () => {
    setup(CALLER)
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(CALLER)
    await openEdit()
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('address')
  })
})
