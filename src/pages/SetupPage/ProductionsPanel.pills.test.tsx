// @vitest-environment jsdom
/**
 * Endpoint copy pills on an active production row (studio#241, OL-43). The old
 * program-level SRT pill read a production field the backend never sets, so it
 * was removed; SRT program delivery is shown via the per-output pills only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { graphicsApi, outputsApi, productionsApi, serverInfoApi, sourcesApi, type ApiOutput, type ApiProduction } from '@/lib/api'
import { useProductionsStore } from '@/store/productions.store'
import { useOutputsStore } from '@/store/outputs.store'
import { ProductionsPanel } from './ProductionsPanel'

const TS = '2026-11-02T00:00:00.000Z'
const OUTPUTS: ApiOutput[] = [
  { id: 'o-srt', name: 'Distribution', outputType: 'mpegtssrt', url: 'srt://:9000?mode=listener', createdAt: TS, updatedAt: TS },
  { id: 'o-whep', name: 'Web', outputType: 'whep', createdAt: TS, updatedAt: TS },
]

function production(overrides: Partial<ApiProduction> = {}): ApiProduction {
  return {
    id: 'p1', name: 'Evening News', status: 'active',
    sources: [], graphicAssignments: [],
    outputAssignments: [{ outputId: 'o-srt' }, { outputId: 'o-whep' }],
    pgmWhepEndpoint: 'https://whep/pgm',
    whipEndpoints: [{ mixerInput: 'video_in_0', url: 'https://whip/0' }],
    whepOutputUrls: [{ outputId: 'o-whep', url: 'https://whep/web' }],
    ...overrides,
  }
}

function pillLabels(): string[] {
  return screen.getAllByRole('button')
    .map((b) => b.textContent ?? '')
    .filter((t) => /^(SRT|WHEP|WHIP) (OUT|IN):/.test(t))
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }))
  vi.spyOn(sourcesApi, 'list').mockResolvedValue([])
  vi.spyOn(graphicsApi, 'list').mockResolvedValue([])
  vi.spyOn(outputsApi, 'list').mockResolvedValue(OUTPUTS)
  vi.spyOn(serverInfoApi, 'get').mockResolvedValue({ stromHost: 'strom.example' })
  useProductionsStore.setState({ productions: [], pendingStatus: {} })
  useOutputsStore.setState({ outputs: [] })
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('ProductionsPanel endpoint pills', () => {
  it('shows exactly WHEP OUT: PGM, the per-output SRT/WHEP pills and the WHIP IN pills', async () => {
    vi.spyOn(productionsApi, 'list').mockResolvedValue([production()])
    render(<MemoryRouter><ProductionsPanel /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('SRT OUT: Distribution')).toBeTruthy())
    expect(pillLabels().sort()).toEqual([
      'SRT OUT: Distribution',
      'WHEP OUT: PGM',
      'WHEP OUT: Web',
      'WHIP IN: Input 1',
    ])
    const srtPill = screen.getByText('SRT OUT: Distribution').closest('button')
    await waitFor(() => expect(srtPill?.getAttribute('title')).toBe('srt://strom.example:9000?mode=caller'))
  })

  it('shows no endpoint pills for an inactive production', async () => {
    vi.spyOn(productionsApi, 'list').mockResolvedValue([production({ status: 'inactive' })])
    render(<MemoryRouter><ProductionsPanel /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('Evening News')).toBeTruthy())
    expect(pillLabels()).toEqual([])
  })
})
