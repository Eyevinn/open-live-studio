// @vitest-environment jsdom
/**
 * Production Options footer while live (studio#235, OL-40). The Record toggle
 * stays editable on a live production (OL-32), so the footer must not claim
 * that nothing can be changed.
 *
 * Slots whose source no longer exists (studio#260): listed as missing at their
 * own pad, removable, never moved by compaction, and counted the same on the
 * production card as in Options.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import {
  graphicsApi, outputsApi, productionConfigsApi, productionsApi, serverInfoApi, sourcesApi,
  type ApiProduction, type ProductionSourceAssignment,
} from '@/lib/api'
import { useProductionsStore, type Production } from '@/store/productions.store'
import { useSourcesStore, type Source } from '@/store/sources.store'
import { useOutputsStore } from '@/store/outputs.store'
import { LIVE_OPTIONS_FOOTER, ProductionOptionsModal, ProductionsPanel } from './ProductionsPanel'

const CAM: Source = { id: 'cam-1', name: 'Cam 1', address: 'srt://cam', streamType: 'srt', status: 'active', color: '#fff' }

function production(overrides: Partial<Production> = {}): Production {
  return {
    id: 'p1', name: 'Evening News', status: 'active',
    sources: [{ sourceId: 'cam-1', mixerInput: 'video_in_0', record: 'off' }],
    graphicAssignments: [], outputAssignments: [], ...overrides,
  }
}

beforeEach(() => {
  vi.spyOn(productionConfigsApi, 'list').mockResolvedValue([])
  useSourcesStore.setState({ sources: [CAM] })
  useProductionsStore.setState({ productions: [] })
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ProductionOptionsModal footer', () => {
  it('says only "Record this input" can be changed while live, and the toggle stays enabled', () => {
    render(<ProductionOptionsModal production={production()} onClose={() => {}} />)
    const footer = screen.getByText(LIVE_OPTIONS_FOOTER)
    expect(footer.textContent).toBe(
      'This production is live. Only “Record this input” can be changed, and it applies from the next activation. Deactivate the production to change anything else.',
    )
    expect(footer.textContent).toContain('Record this input')
    expect(screen.queryByText('Deactivate this production to make changes.')).toBeNull()
    const toggle = screen.getByRole('checkbox', { name: 'Record Cam 1' }) as HTMLInputElement
    expect(toggle.disabled).toBe(false)
  })

  it('shows no live footer when the production is not active', () => {
    render(<ProductionOptionsModal production={production({ status: 'inactive' })} onClose={() => {}} />)
    expect(screen.queryByText(LIVE_OPTIONS_FOOTER)).toBeNull()
  })
})

const CAM2: Source = { id: 'cam-2', name: 'Cam 2', address: 'srt://cam2', streamType: 'srt', status: 'active', color: '#fff' }

/** Records every source-assignment request the modal sends, in order. */
function trackSourceRequests(): string[] {
  const requests: string[] = []
  vi.spyOn(productionsApi, 'assignSource').mockImplementation(async (_id, a: ProductionSourceAssignment) => {
    requests.push(`POST ${a.mixerInput} ${a.sourceId}`)
    return { ...a, _rev: '1' }
  })
  vi.spyOn(productionsApi, 'unassignSource').mockImplementation(async (_id, mixerInput: string) => {
    requests.push(`DELETE ${mixerInput}`)
  })
  vi.spyOn(productionsApi, 'setSourceRecord').mockImplementation(async (_id, mixerInput: string, record) => {
    requests.push(`PUT ${mixerInput} ${record}`)
    return { mixerInput, sourceId: '', record, appliesFrom: 'next-activation', currentlyRecording: false, recordingOutputAssigned: true, _rev: '1' }
  })
  return requests
}

function slotValues(): string[] {
  return screen.queryAllByRole('combobox', { name: /^Input \d+ source$/ }).map((el) => (el as HTMLSelectElement).value)
}

describe('ProductionOptionsModal: slot whose source no longer exists (studio#260)', () => {
  beforeEach(() => { useSourcesStore.setState({ sources: [CAM, CAM2] }) })

  it('AC1: lists the orphan at its own pad, marked missing, and compaction does not move it', async () => {
    const requests = trackSourceRequests()
    const prod = production({
      status: 'inactive',
      sources: [
        { sourceId: 'cam-1', mixerInput: 'video_in_0' },
        { sourceId: 'src-gone', mixerInput: 'video_in_1' },
        { sourceId: 'cam-2', mixerInput: 'video_in_3' },
      ],
    })
    render(<ProductionOptionsModal production={prod} onClose={() => {}} />)

    expect(slotValues()).toEqual(['cam-1', 'src-gone', 'cam-2'])
    const orphan = screen.getByRole('combobox', { name: 'Input 2 source' }) as HTMLSelectElement
    expect(orphan.getAttribute('aria-invalid')).toBe('true')
    expect(orphan.selectedOptions[0]?.textContent).toBe('Missing source (src-gone)')
    expect(within(screen.getByRole('combobox', { name: 'Input 1 source' })).queryByText(/Missing source/)).toBeNull()

    // The gap at video_in_2 is closed by moving cam-2 down; video_in_1 is never touched.
    await waitFor(() => expect(requests).toEqual(['POST video_in_2 cam-2', 'DELETE video_in_3']))
    expect(requests.some((r) => r.includes('video_in_1'))).toBe(false)
  })

  it('AC1: Remove on the orphan row sends DELETE on its pad, then shifts the rows below up', async () => {
    const requests = trackSourceRequests()
    const prod = production({
      status: 'inactive',
      sources: [
        { sourceId: 'cam-1', mixerInput: 'video_in_0' },
        { sourceId: 'src-gone', mixerInput: 'video_in_1' },
        { sourceId: 'cam-2', mixerInput: 'video_in_2' },
      ],
    })
    render(<ProductionOptionsModal production={prod} onClose={() => {}} />)
    expect(slotValues()).toEqual(['cam-1', 'src-gone', 'cam-2'])

    const removeButtons = screen.getAllByTitle('Remove input')
    fireEvent.click(removeButtons[1]!)

    await waitFor(() => expect(requests).toEqual(['DELETE video_in_1', 'POST video_in_1 cam-2', 'DELETE video_in_2']))
    expect(slotValues()).toEqual(['cam-1', 'cam-2'])
    expect(screen.queryByText(/Missing source/)).toBeNull()
  })

  it('AC1: Remove on an orphan in the last row only sends DELETE on its pad', async () => {
    const requests = trackSourceRequests()
    const prod = production({
      status: 'inactive',
      sources: [
        { sourceId: 'cam-1', mixerInput: 'video_in_0' },
        { sourceId: 'cam-2', mixerInput: 'video_in_1' },
        { sourceId: 'src-gone', mixerInput: 'video_in_2' },
      ],
    })
    render(<ProductionOptionsModal production={prod} onClose={() => {}} />)
    fireEvent.click(screen.getAllByTitle('Remove input')[2]!)
    await waitFor(() => expect(requests).toEqual(['DELETE video_in_2']))
    expect(slotValues()).toEqual(['cam-1', 'cam-2'])
  })

  it('marks the orphan missing in the live (read-only) view too', () => {
    const prod = production({
      sources: [
        { sourceId: 'cam-1', mixerInput: 'video_in_0' },
        { sourceId: 'src-gone', mixerInput: 'video_in_1' },
      ],
    })
    render(<ProductionOptionsModal production={prod} onClose={() => {}} />)
    expect(screen.getByText('Cam 1')).toBeTruthy()
    expect(screen.getByText('Missing source (src-gone)')).toBeTruthy()
  })
})

describe('ProductionsPanel: card source count matches Options rows (studio#260 AC2)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }))
    vi.spyOn(sourcesApi, 'list').mockResolvedValue([
      { id: 'cam-1', name: 'Cam 1', address: 'srt://cam', streamType: 'srt', status: 'active' },
    ])
    vi.spyOn(graphicsApi, 'list').mockResolvedValue([])
    vi.spyOn(outputsApi, 'list').mockResolvedValue([])
    vi.spyOn(serverInfoApi, 'get').mockResolvedValue({ stromHost: 'strom.example' })
    useSourcesStore.setState({ sources: [] })
    useProductionsStore.setState({ productions: [], pendingStatus: {} })
    useOutputsStore.setState({ outputs: [] })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('counts test patterns and orphans in both, and the returnFeed guest slot in neither', async () => {
    trackSourceRequests()
    const prod: ApiProduction = {
      id: 'p1', name: 'Evening News', status: 'inactive',
      sources: [
        { sourceId: 'cam-1', mixerInput: 'video_in_0' },
        { sourceId: '__test1__', mixerInput: 'video_in_1' },
        { sourceId: 'src-gone', mixerInput: 'video_in_2' },
        { sourceId: 'Whip', mixerInput: 'video_in_15', returnFeed: { synced: 'program-minus' } },
      ],
      graphicAssignments: [], outputAssignments: [],
    }
    vi.spyOn(productionsApi, 'list').mockResolvedValue([prod])
    render(<MemoryRouter><ProductionsPanel /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('3 sources')).toBeTruthy())
    await waitFor(() => expect(useSourcesStore.getState().sources.map((s) => s.id)).toEqual(['cam-1']))
    fireEvent.click(screen.getByRole('button', { name: /Options/ }))

    await waitFor(() => expect(screen.getByText('Production Options')).toBeTruthy())
    const assigned = slotValues().filter(Boolean)
    expect(assigned).toEqual(['cam-1', '__test1__', 'src-gone'])
    expect(assigned).toHaveLength(3)
  })
})
