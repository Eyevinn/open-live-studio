// @vitest-environment jsdom
/**
 * Edit Source / New Source latency handling (studio#242, OL-44). The backend
 * accepts `latency` only as an integer from 20 to 8000 ms; the dialogs must
 * reject anything else inline, keep the stored value when the Edit field is
 * empty, and keep the dialog open with the reason when a PATCH is rejected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError, gatewaysApi, serverInfoApi, sourcesApi, type ApiSource } from '@/lib/api'
import { LATENCY_RANGE_MESSAGE } from '@/lib/latency'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { SourcesPanel } from './SourcesPanel'

const CAM: ApiSource = {
  id: 'cam-1',
  name: 'Cam 1',
  address: 'srt://sender.example.com:9000?mode=caller',
  streamType: 'srt',
  status: 'inactive',
  latency: 300,
  audioStreamIndex: 0,
}

const LABEL = 'Latency (ms, 20-8000, default 125)'

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.spyOn(sourcesApi, 'list').mockResolvedValue([CAM])
  vi.spyOn(sourcesApi, 'audioStreams').mockResolvedValue({ discovery: 'unavailable', reason: 'no-live-flow', streams: [] } as never)
  vi.spyOn(gatewaysApi, 'list').mockResolvedValue([])
  vi.spyOn(serverInfoApi, 'get').mockResolvedValue(null as never)
  useSourcesStore.setState({ sources: [], isLoading: false, lastFetchedAt: Date.now() })
  useProductionsStore.setState({ productions: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openEditDialog(): Promise<HTMLInputElement> {
  render(<SourcesPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  await screen.findByText('Edit Source')
  return screen.getByLabelText(LABEL) as HTMLInputElement
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('Edit Source latency', () => {
  it('rejects 10 ms inline, keeps the dialog open and does not PATCH', async () => {
    const update = vi.spyOn(sourcesApi, 'update')
    const input = await openEditDialog()
    fireEvent.change(input, { target: { value: '10' } })
    save()
    expect(await screen.findByText(LATENCY_RANGE_MESSAGE)).toBeTruthy()
    expect(screen.getByText('Edit Source')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })

  it.each([20, 8000])('PATCHes %i ms and closes the dialog', async (value) => {
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue({ ...CAM, latency: value })
    const input = await openEditDialog()
    fireEvent.change(input, { target: { value: String(value) } })
    save()
    await waitFor(() => expect(screen.queryByText('Edit Source')).toBeNull())
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toMatchObject({ latency: value })
  })

  it('sends no latency key when the field is empty', async () => {
    const update = vi.spyOn(sourcesApi, 'update').mockResolvedValue(CAM)
    const input = await openEditDialog()
    fireEvent.change(input, { target: { value: '' } })
    save()
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('latency')
  })

  it('keeps the dialog open with the backend reason when the PATCH is rejected', async () => {
    const err = new ApiError('Validation error', 400, {
      error: 'Validation error',
      issues: [{ path: ['latency'], message: 'Number must be greater than or equal to 20' }],
    })
    const update = vi.spyOn(sourcesApi, 'update').mockRejectedValue(err)
    const input = await openEditDialog()
    fireEvent.change(input, { target: { value: '500' } })
    save()
    expect(await screen.findByText('Validation error: latency: Number must be greater than or equal to 20')).toBeTruthy()
    expect(screen.getByText('Edit Source')).toBeTruthy()
    // Shown inline only: the global toast is suppressed for this call.
    expect(update.mock.calls[0]?.[2]).toEqual({ quiet: true })
  })

  it('uses the same limits as New Source', async () => {
    const input = await openEditDialog()
    expect(input.min).toBe('20')
    expect(input.max).toBe('8000')
  })
})

describe('New Source latency', () => {
  it('rejects 0 ms inline and does not create the source', async () => {
    const create = vi.spyOn(sourcesApi, 'create')
    render(<SourcesPanel />)
    await screen.findByText('Cam 1')
    fireEvent.click(screen.getByRole('button', { name: '+ New Source' }))
    const input = (await screen.findByLabelText(LABEL)) as HTMLInputElement
    expect(input.min).toBe('20')
    expect(input.max).toBe('8000')
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Cam 2' } })
    // No reserved port range on this backend, so the listener port is typed.
    fireEvent.change(await screen.findByPlaceholderText('e.g. 9000'), { target: { value: '9001' } })
    fireEvent.change(input, { target: { value: '0' } })
    save()
    expect(await screen.findByText(LATENCY_RANGE_MESSAGE)).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })
})
