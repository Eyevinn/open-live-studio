// @vitest-environment jsdom
/**
 * Phone tally strip PGM/PVW names for guest slots (studio#262, spec
 * open-live docs/specs/guest-slot-input-numbering.md test plan 1-3): a guest
 * slot shows "Guest N" or the joined guest's label, never the raw `WHIP`; a
 * manual WHIP source without `returnFeed` keeps its name.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore, type Production } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { useGuestsStore } from '@/store/guests.store'
import { PhoneTallyStrip } from './PhoneTallyStrip'

const production: Production = {
  id: 'p1',
  name: 'Show',
  status: 'active',
  sources: [
    { sourceId: 'cam-1', mixerInput: 'video_in_0' },
    { sourceId: 'Whip', mixerInput: 'video_in_3' },
    { sourceId: 'Whip', mixerInput: 'video_in_14', returnFeed: { synced: 'program-minus' } },
    { sourceId: 'Whip', mixerInput: 'video_in_15', returnFeed: { synced: 'program-minus' } },
  ],
  graphicAssignments: [],
  outputAssignments: [],
}

/** Name shown on the PGM / PVW row. */
function rowName(label: 'PGM' | 'PVW'): string {
  const row = screen.getByText(label).parentElement
  return row?.lastElementChild?.textContent ?? ''
}

function onBuses(pgm: string, pvw: string) {
  const s = useProductionStore.getState()
  s.setPgm(pgm)
  s.setPvw(pvw)
}

beforeEach(() => {
  useSourcesStore.setState({
    sources: [{ id: 'cam-1', name: 'Cam 1', address: '', streamType: 'srt', status: 'active' }],
  } as Partial<ReturnType<typeof useSourcesStore.getState>>)
  useProductionsStore.setState({ productions: [production] })
  useProductionStore.getState().setActiveProduction('p1')
  useGuestsStore.getState().reset()
})

afterEach(() => {
  cleanup()
})

describe('PhoneTallyStrip guest slot names', () => {
  it('shows "Guest N" for a guest slot with no guest joined', () => {
    onBuses('video_in_15', 'video_in_14')
    render(<PhoneTallyStrip />)
    expect(rowName('PGM')).toBe('Guest 1')
    expect(rowName('PVW')).toBe('Guest 2')
  })

  it("shows the joined guest's invite label", () => {
    useGuestsStore.getState().applyGuestState({ guestId: 'g1', mixerInput: 'video_in_15', state: 'on-air', label: 'Alice · In 16', muted: false })
    onBuses('video_in_15', 'video_in_14')
    render(<PhoneTallyStrip />)
    expect(rowName('PGM')).toBe('Alice · In 16')
    expect(rowName('PVW')).toBe('Guest 2')
  })

  it('leaves non-guest sources unchanged, including a manual WHIP source', () => {
    onBuses('video_in_3', 'video_in_0')
    render(<PhoneTallyStrip />)
    expect(rowName('PGM')).toBe('WHIP')
    expect(rowName('PVW')).toBe('Cam 1')
  })
})
