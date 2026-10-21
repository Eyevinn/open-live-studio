// @vitest-environment jsdom
/**
 * Component tests for the Recordings tab Delete action (studio#229, OL-30b).
 *
 * `fetch` is stubbed with a small router that mimics open-live: the SAT
 * exchange answers 503 (no token, as in local dev), productions and storage
 * connections are listed, and `DELETE /api/v1/recordings/:id` answers with
 * whatever the test queues (contract from open-live #550 / PR #557). The real
 * API client, stores and panel run unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ApiRecording } from '@/lib/api'
import { DELETE_WARNING, RECORDINGS_EMPTY_MESSAGE } from '@/lib/recordings'
import { useRecordingsStore } from '@/store/recordings.store'
import { RecordingsPanel } from './RecordingsPanel'

function makeRecording(overrides: Partial<ApiRecording> = {}): ApiRecording {
  return {
    id: 'recording-1',
    productionId: 'prod-1',
    bucket: 'recordings',
    key: 'prod-1/first.mp4',
    sizeBytes: 2 * 1024 * 1024,
    durationMs: 60_000,
    startedAt: '2026-10-19T10:00:00.000Z',
    createdAt: '2026-10-19T10:05:00.000Z',
    updatedAt: '2026-10-19T10:05:00.000Z',
    playbackUrl: 'https://s3.example.com/recordings/first.mp4?X-Amz-Signature=a',
    downloadUrl: 'https://s3.example.com/recordings/first.mp4?X-Amz-Signature=a&response-content-disposition=attachment',
    ...overrides,
  }
}

const FIRST = makeRecording()
const SECOND = makeRecording({
  id: 'recording-2',
  key: 'prod-1/second.mp4',
  startedAt: '2026-10-18T10:00:00.000Z',
})

interface DeleteReply {
  status: number
  body?: unknown
}

let listed: ApiRecording[] = []
let deleteReplies: Array<DeleteReply | Promise<DeleteReply>> = []
const deleteCalls: string[] = []

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input))
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname
  if (path === '/api/v1/auth/token') return json(503, { error: 'No PAT configured' })
  if (path === '/api/v1/productions' && method === 'GET') {
    return json(200, [{ _id: 'prod-1', name: 'Evening News', status: 'inactive' }])
  }
  if (path === '/api/v1/storage-connections' && method === 'GET') return json(200, [])
  if (path === '/api/v1/recordings' && method === 'GET') return json(200, listed)
  const m = path.match(/^\/api\/v1\/recordings\/([^/]+)$/)
  if (m && method === 'DELETE') {
    const id = decodeURIComponent(m[1]!)
    deleteCalls.push(id)
    const reply = await (deleteReplies.shift() ?? { status: 204 })
    if (reply.status === 204) {
      listed = listed.filter((r) => r.id !== id)
      return new Response(null, { status: 204 })
    }
    return json(reply.status, reply.body ?? {})
  }
  return json(404, { error: `Unhandled ${method} ${path}` })
})

beforeEach(() => {
  listed = [FIRST, SECOND]
  deleteReplies = []
  deleteCalls.length = 0
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  useRecordingsStore.setState({ recordings: [], productionFilter: null, isLoading: false, loadError: null, loaded: false })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderPanel() {
  render(<RecordingsPanel />)
  await screen.findByText('first.mp4')
  await screen.findAllByText('Evening News')
}

function rowOf(fileName: string): HTMLElement {
  const row = screen.getByText(fileName).closest('tr')
  if (!row) throw new Error(`no row for ${fileName}`)
  return row
}

function button(scope: HTMLElement, name: string | RegExp): HTMLButtonElement {
  return within(scope).getByRole('button', { name }) as HTMLButtonElement
}

function openConfirm(fileName: string) {
  fireEvent.click(button(rowOf(fileName), 'Delete'))
}

function dialog(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'Delete recording' })
  // Heading -> header bar -> dialog panel.
  return heading.parentElement!.parentElement!
}

describe('RecordingsPanel Delete (studio#229)', () => {
  it('shows Play, Download and Delete on each row, Delete after Download', async () => {
    await renderPanel()
    for (const file of ['first.mp4', 'second.mp4']) {
      const labels = within(rowOf(file)).getAllByRole('button').map((b) => b.textContent)
      expect(labels).toEqual(['Play', 'Download', 'Delete'])
    }
  })

  it('confirmation names the production, start time and size, with Cancel focused', async () => {
    await renderPanel()
    openConfirm('first.mp4')
    const d = dialog()
    expect(within(d).getByText('Evening News')).toBeTruthy()
    expect(within(d).getByText(new Date(FIRST.startedAt).toLocaleString())).toBeTruthy()
    expect(within(d).getByText('2.0 MB')).toBeTruthy()
    expect(within(d).getByText(DELETE_WARNING)).toBeTruthy()
    expect(document.activeElement).toBe(button(d, 'Cancel'))
  })

  it('Cancel closes the dialog and nothing is deleted', async () => {
    await renderPanel()
    openConfirm('first.mp4')
    fireEvent.click(button(dialog(), 'Cancel'))
    expect(screen.queryByRole('heading', { name: 'Delete recording' })).toBeNull()
    expect(deleteCalls).toEqual([])
    expect(screen.getByText('first.mp4')).toBeTruthy()
    expect(screen.getByText('second.mp4')).toBeTruthy()
  })

  it('Escape also cancels without deleting', async () => {
    await renderPanel()
    openConfirm('first.mp4')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Delete recording' })).toBeNull()
    expect(deleteCalls).toEqual([])
  })

  it('confirm sends DELETE and removes only that row on 204', async () => {
    await renderPanel()
    openConfirm('first.mp4')
    fireEvent.click(button(dialog(), 'Delete'))
    await waitFor(() => expect(screen.queryByText('first.mp4')).toBeNull())
    expect(deleteCalls).toEqual(['recording-1'])
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(String(call?.[0])).toMatch(/\/api\/v1\/recordings\/recording-1$/)
    expect(screen.getByText('second.mp4')).toBeTruthy()
    expect(screen.getByText('1 recording')).toBeTruthy()
  })

  it('deleting the last recording shows the empty state', async () => {
    listed = [FIRST]
    await renderPanel()
    openConfirm('first.mp4')
    fireEvent.click(button(dialog(), 'Delete'))
    await screen.findByText(RECORDINGS_EMPTY_MESSAGE)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('while deleting, the row is busy and its buttons are disabled; other rows still work', async () => {
    let finish: (r: DeleteReply) => void = () => {}
    deleteReplies.push(new Promise<DeleteReply>((resolve) => { finish = resolve }))
    await renderPanel()
    openConfirm('first.mp4')
    fireEvent.click(button(dialog(), 'Delete'))

    const busy = await within(rowOf('first.mp4')).findByRole('button', { name: 'Deleting…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    expect(button(rowOf('first.mp4'), 'Play').disabled).toBe(true)
    expect(button(rowOf('first.mp4'), 'Download').disabled).toBe(true)
    expect(button(rowOf('second.mp4'), 'Play').disabled).toBe(false)
    expect(button(rowOf('second.mp4'), 'Download').disabled).toBe(false)
    expect(button(rowOf('second.mp4'), 'Delete').disabled).toBe(false)

    await act(async () => { finish({ status: 204 }) })
    await waitFor(() => expect(screen.queryByText('first.mp4')).toBeNull())
  })

  it('502 storage-denied keeps the row and says the key may not delete the file', async () => {
    deleteReplies.push({ status: 502, body: { error: 'Storage refused the delete', reason: 'storage-denied', statusCode: 502 } })
    await renderPanel()
    openConfirm('first.mp4')
    fireEvent.click(button(dialog(), 'Delete'))

    const alert = await within(rowOf('first.mp4')).findByRole('alert')
    expect(alert.textContent).toBe('The storage key is not allowed to delete this file. The recording was kept.')
    expect(within(rowOf('second.mp4')).queryByRole('alert')).toBeNull()
    expect(button(rowOf('first.mp4'), 'Delete').disabled).toBe(false)
  })

  it("starting another row's delete keeps the first row's error", async () => {
    deleteReplies.push({ status: 502, body: { error: 'x', reason: 'storage-failed', statusCode: 502 } })
    deleteReplies.push({ status: 502, body: { error: 'x', reason: 'storage-denied', statusCode: 502 } })
    await renderPanel()
    openConfirm('first.mp4')
    fireEvent.click(button(dialog(), 'Delete'))
    const firstAlert = await within(rowOf('first.mp4')).findByRole('alert')
    expect(firstAlert.textContent).toBe('The storage could not delete the file. The recording was kept. Try again.')

    openConfirm('second.mp4')
    expect(within(rowOf('first.mp4')).getByRole('alert').textContent).toBe(firstAlert.textContent)
    fireEvent.click(button(dialog(), 'Delete'))
    const secondAlert = await within(rowOf('second.mp4')).findByRole('alert')
    expect(secondAlert.textContent).toBe('The storage key is not allowed to delete this file. The recording was kept.')
    expect(within(rowOf('first.mp4')).getByRole('alert').textContent).toBe(
      'The storage could not delete the file. The recording was kept. Try again.',
    )

    // Retrying the first row clears only its own error.
    deleteReplies.push({ status: 204 })
    openConfirm('first.mp4')
    fireEvent.click(button(dialog(), 'Delete'))
    await waitFor(() => expect(screen.queryByText('first.mp4')).toBeNull())
    expect(within(rowOf('second.mp4')).getByRole('alert').textContent).toBe(secondAlert.textContent)
  })

  it.each([
    [409, { error: 'x', reason: 'connection-missing' }, "Cannot delete: the recording's storage connection no longer exists. Nothing was deleted."],
    [409, { error: 'x', reason: 'bucket-mismatch' }, 'Cannot delete: the recording is in a bucket other than the instance default bucket. Nothing was deleted.'],
    [502, { error: 'x', reason: 'storage-failed' }, 'The storage could not delete the file. The recording was kept. Try again.'],
    [404, { error: 'Recording not found' }, 'Recording not found. It may already have been deleted. Refresh the list.'],
    [503, { error: 'Database unavailable' }, 'The database is unavailable, so the recording could not be removed from the list. Try Delete again.'],
  ])('HTTP %i %o keeps the row and shows the mapped message', async (status, body, message) => {
    deleteReplies.push({ status, body })
    await renderPanel()
    openConfirm('first.mp4')
    fireEvent.click(button(dialog(), 'Delete'))
    const alert = await within(rowOf('first.mp4')).findByRole('alert')
    expect(alert.textContent).toBe(message)
    expect(useRecordingsStore.getState().recordings.map((r) => r.id)).toContain('recording-1')
  })
})
