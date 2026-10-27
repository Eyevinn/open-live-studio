// @vitest-environment jsdom
/**
 * Production Options footer while live (studio#235, OL-40). The Record toggle
 * stays editable on a live production (OL-32), so the footer must not claim
 * that nothing can be changed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { productionConfigsApi } from '@/lib/api'
import { useProductionsStore, type Production } from '@/store/productions.store'
import { useSourcesStore, type Source } from '@/store/sources.store'
import { LIVE_OPTIONS_FOOTER, ProductionOptionsModal } from './ProductionsPanel'

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
