// @vitest-environment jsdom
/**
 * Removing a stored SRT passphrase from the Edit Output dialog (studio#257). The
 * backend masks a stored passphrase as `passphrase=***`, keeps the stored URL
 * when none is sent, and replaces it in full when one is: "Remove passphrase"
 * sends the URL without `passphrase=`, an empty field sends no URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { outputsApi, serverInfoApi, storageConnectionsApi, type ApiOutput } from '@/lib/api'
import { useOutputsStore } from '@/store/outputs.store'
import { useProductionsStore } from '@/store/productions.store'
import { OutputsPanel } from './OutputsPanel'

const LISTENER: ApiOutput = {
  id: 'out-1',
  name: 'Program feed',
  outputType: 'mpegtssrt',
  url: 'srt://:9100?mode=listener&passphrase=***',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const CALLER: ApiOutput = {
  ...LISTENER,
  url: 'srt://cdn.example.com:9000?mode=caller&passphrase=***',
}

function setup(output: ApiOutput) {
  vi.spyOn(outputsApi, 'list').mockResolvedValue([output])
  useOutputsStore.setState({ outputs: [], isLoading: false, lastFetchedAt: Date.now() })
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.spyOn(storageConnectionsApi, 'list').mockResolvedValue([])
  vi.spyOn(serverInfoApi, 'get').mockResolvedValue(null as never)
  useProductionsStore.setState({ productions: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openEdit() {
  render(<OutputsPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  await screen.findByText('Edit Output')
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('Edit Output passphrase (listener)', () => {
  it('"Remove passphrase" sends the URL without a passphrase and the list shows none', async () => {
    setup(LISTENER)
    const update = vi.spyOn(outputsApi, 'update').mockResolvedValue({ ...LISTENER, url: 'srt://:9100?mode=listener' })
    await openEdit()
    expect(screen.getAllByText(/with the passphrase/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Remove passphrase' }))
    expect((screen.getByPlaceholderText('Removed on save') as HTMLInputElement).disabled).toBe(true)
    save()
    await waitFor(() => expect(screen.queryByText('Edit Output')).toBeNull())
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toMatchObject({ url: 'srt://:9100?mode=listener' })
    expect(screen.queryAllByText(/with the passphrase/)).toHaveLength(0)
  })

  it('keeps the stored passphrase when the field is left empty (no URL sent)', async () => {
    setup(LISTENER)
    const update = vi.spyOn(outputsApi, 'update').mockResolvedValue(LISTENER)
    await openEdit()
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('url')
  })
})

describe('Edit Output passphrase (caller)', () => {
  it('"Remove passphrase" strips it from the destination address and sends that', async () => {
    setup(CALLER)
    const update = vi.spyOn(outputsApi, 'update').mockResolvedValue({ ...CALLER, url: 'srt://cdn.example.com:9000?mode=caller' })
    await openEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Remove passphrase' }))
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).toMatchObject({ url: 'srt://cdn.example.com:9000?mode=caller' })
  })

  it('blocks a changed address that still carries the masked passphrase', async () => {
    setup(CALLER)
    const update = vi.spyOn(outputsApi, 'update')
    await openEdit()
    fireEvent.change(screen.getByDisplayValue(CALLER.url!), {
      target: { value: 'srt://other.example.com:9000?mode=caller&passphrase=***' },
    })
    save()
    expect(await screen.findByText(/The passphrase is hidden as \*\*\*/)).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })
})
