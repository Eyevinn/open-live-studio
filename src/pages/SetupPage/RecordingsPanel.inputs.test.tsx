// @vitest-environment jsdom
/**
 * Input recordings in the Recordings tab (studio#233, OL-32 §2.4 / §2.5 / §8).
 * `fetch` is stubbed with a small router that applies the list endpoints'
 * `kind` / `mixerInput` query filters like open-live does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ApiRecording } from '@/lib/api'
import { useRecordingsStore } from '@/store/recordings.store'
import { RecordingsPanel } from './RecordingsPanel'

function makeRecording(overrides: Partial<ApiRecording>): ApiRecording {
  return {
    id: 'recording-x',
    productionId: 'prod-1',
    bucket: 'recordings',
    key: 'prod-1/x.mp4',
    sizeBytes: 1024,
    durationMs: 300_000,
    startedAt: '2026-10-25T18:00:00.000Z',
    createdAt: '2026-10-25T19:00:00.000Z',
    updatedAt: '2026-10-25T19:00:00.000Z',
    playbackUrl: 'https://s3.example.com/x.mp4?X-Amz-Signature=a',
    ...overrides,
  }
}

const PGM0 = makeRecording({ id: 'pgm-0', key: 'prod-1/pgm_00000.mp4', activationId: 'flow-a', kind: 'program', partIndex: 0 })
const PGM1 = makeRecording({ id: 'pgm-1', key: 'prod-1/pgm_00001.mp4', activationId: 'flow-a', kind: 'program', partIndex: 1, startedAt: '2026-10-25T18:05:00.000Z' })
const CAM = makeRecording({
  id: 'in-cam', key: 'prod-1/video_in_0/cam_00000.mp4', activationId: 'flow-a', kind: 'input', partIndex: 0,
  mixerInput: 'video_in_0', sourceId: 'cam-1', sourceName: 'Cam 1', streamType: 'srt',
})
const GUEST = makeRecording({
  id: 'in-guest', key: 'prod-1/video_in_15/guest_00000.mp4', activationId: 'flow-a', kind: 'input', partIndex: 0,
  mixerInput: 'video_in_15', sourceId: 'Whip', sourceName: 'Guest 1 · In 16', streamType: 'whip', guestLabel: 'Anna',
})
const OLDER = makeRecording({ id: 'pgm-old', key: 'prod-1/old.mp4', startedAt: '2026-10-20T18:00:00.000Z' })

let listed: ApiRecording[] = []
const listUrls: string[] = []

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
  if ((path === '/api/v1/recordings' || path === '/api/v1/productions/prod-1/recordings') && method === 'GET') {
    listUrls.push(`${path}${url.search}`)
    const kind = url.searchParams.get('kind')
    const mixerInput = url.searchParams.get('mixerInput')
    return json(200, listed.filter((r) =>
      (!kind || (r.kind ?? 'program') === kind) && (!mixerInput || r.mixerInput === mixerInput)))
  }
  return json(404, { error: `Unhandled ${method} ${path}` })
})

beforeEach(() => {
  listUrls.length = 0
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  useRecordingsStore.setState({
    recordings: [], productionFilter: null, isLoading: false, loadError: null, loaded: false, kindFilter: null, inputFilter: null,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function groupOf(activationId: string): HTMLElement {
  return screen.getByRole('rowgroup', { name: `Activation ${activationId}` })
}

describe('RecordingsPanel input recordings (studio#233)', () => {
  it('groups by activation and labels program and each input with source and guest names (AC 2)', async () => {
    listed = [GUEST, PGM1, CAM, PGM0, OLDER]
    render(<RecordingsPanel />)
    await screen.findByText('cam_00000.mp4')
    const g = groupOf('flow-a')
    const files = within(g).getAllByRole('row').slice(1).map((tr) => tr.querySelector('td')?.textContent)
    expect(files).toEqual(['pgm_00000.mp4', 'pgm_00001.mp4', 'cam_00000.mp4', 'guest_00000.mp4'])
    expect(within(g).getByText('Cam 1')).toBeTruthy()
    expect(within(g).getByText('Guest 1 · In 16 (Anna)')).toBeTruthy()
    expect(within(g).getByText(/4 files/)).toBeTruthy()
    // Each input part plays and downloads like program.
    const guestRow = within(g).getByText('guest_00000.mp4').closest('tr')!
    expect((within(guestRow).getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(false)
    expect((within(guestRow).getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(false)
    // The part without an activation id is listed after the activations.
    expect(groupOf('unknown')).toBeTruthy()
  })

  it('renders a program-only list exactly as before: flat, no Source column, no filters (AC 4)', async () => {
    listed = [PGM0, OLDER]
    render(<RecordingsPanel />)
    await screen.findByText('pgm_00000.mp4')
    expect(screen.queryByRole('columnheader', { name: 'Source' })).toBeNull()
    expect(screen.queryByRole('rowgroup', { name: /Activation/ })).toBeNull()
    expect(screen.queryByLabelText('Files')).toBeNull()
    expect(screen.queryByLabelText('Input')).toBeNull()
    expect(listUrls).toEqual(['/api/v1/recordings'])
  })

  it('filters by kind and by input with the list query filters', async () => {
    listed = [GUEST, PGM1, CAM, PGM0]
    render(<RecordingsPanel initialProductionId="prod-1" />)
    await screen.findByText('cam_00000.mp4')

    fireEvent.change(screen.getByLabelText('Input'), { target: { value: 'video_in_15' } })
    await waitFor(() => expect(screen.queryByText('cam_00000.mp4')).toBeNull())
    expect(screen.getByText('guest_00000.mp4')).toBeTruthy()
    expect(listUrls.at(-1)).toBe('/api/v1/productions/prod-1/recordings?mixerInput=video_in_15')
    // The other input stays offered while the list is narrowed.
    const options = within(screen.getByLabelText('Input')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['All inputs', 'Cam 1 · Input 1', 'Guest 1 · In 16 · Input 16'])

    fireEvent.change(screen.getByLabelText('Files'), { target: { value: 'program' } })
    await screen.findByText('pgm_00000.mp4')
    expect(listUrls.at(-1)).toBe('/api/v1/productions/prod-1/recordings?kind=program')
    expect(screen.queryByText('guest_00000.mp4')).toBeNull()
    expect(screen.queryByLabelText('Input')).toBeNull()
  })
})
