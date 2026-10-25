// @vitest-environment jsdom
/**
 * Recording indicator on the vision-mixer input tiles (studio#233, OL-32 AC 1):
 * exactly the inputs in `RECORDING_STATE` get a REC mark, keyed by the stored
 * mixerInput.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore, type Production } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { TransitionPanel } from './TransitionPanel'

function production(overrides: Partial<Production> = {}): Production {
  return {
    id: 'p1',
    name: 'Show',
    status: 'active',
    sources: [
      { sourceId: 'cam-1', mixerInput: 'video_in_0', record: 'transcode' },
      { sourceId: 'cam-2', mixerInput: 'video_in_1' },
      { sourceId: 'cam-3', mixerInput: 'video_in_2', record: 'transcode' },
    ],
    graphicAssignments: [],
    outputAssignments: [],
    ...overrides,
  }
}

const noop = () => {}

function renderPanel() {
  render(<TransitionPanel onCut={noop} onAuto={noop} onFtb={noop} onSelectPvw={noop} onSetOvl={noop} />)
}

/** REC marks per tile name, PGM row and PVW row together. */
function recordedTiles(): string[] {
  return screen.getAllByRole('img', { name: 'Recording this input' })
    .map((el) => el.closest('button')?.textContent?.replace('REC', '').trim() ?? '')
    .sort()
}

beforeEach(() => {
  useSourcesStore.setState({
    sources: [
      { id: 'cam-1', name: 'Cam 1', address: '', streamType: 'srt', status: 'active' },
      { id: 'cam-2', name: 'Cam 2', address: '', streamType: 'srt', status: 'active' },
      { id: 'cam-3', name: 'Cam 3', address: '', streamType: 'efp', status: 'active' },
    ],
  } as Partial<ReturnType<typeof useSourcesStore.getState>>)
  useProductionStore.getState().setActiveProduction('p1')
})

afterEach(() => {
  cleanup()
})

describe('TransitionPanel recording indicator', () => {
  it('marks exactly the two inputs in RECORDING_STATE, on both rows', () => {
    useProductionsStore.setState({ productions: [production()] })
    useProductionStore.getState().applyRecordingState({
      program: true,
      inputs: [
        { mixerInput: 'video_in_0', sourceId: 'cam-1', sourceName: 'Cam 1' },
        { mixerInput: 'video_in_2', sourceId: 'cam-3', sourceName: 'Cam 3' },
      ],
    })
    renderPanel()
    expect(recordedTiles()).toEqual(['CAM 1', 'CAM 1', 'CAM 3', 'CAM 3'])
  })

  it('uses production.inputRecordings until the first frame arrives', () => {
    useProductionsStore.setState({
      productions: [production({ inputRecordings: [{ mixerInput: 'video_in_2', sourceId: 'cam-3', sourceName: 'Cam 3', streamType: 'efp' }] })],
    })
    renderPanel()
    expect(recordedTiles()).toEqual(['CAM 3', 'CAM 3'])
  })

  it('shows no mark for a production that records no inputs (AC 4)', () => {
    useProductionsStore.setState({ productions: [production({ sources: [{ sourceId: 'cam-1', mixerInput: 'video_in_0' }] })] })
    useProductionStore.getState().applyRecordingState({ program: true, inputs: [] })
    renderPanel()
    expect(screen.queryAllByRole('img', { name: 'Recording this input' })).toHaveLength(0)
  })

  it('flags an input set to record that this activation does not record', () => {
    useProductionsStore.setState({
      productions: [production({
        activationWarnings: [{ type: 'input-recording-no-output', mixerInputs: ['video_in_0'], message: 'No Recording output.' }],
      })],
    })
    useProductionStore.getState().applyRecordingState({ program: false, inputs: [] })
    renderPanel()
    const badges = screen.getAllByRole('img', { name: 'Input not recorded' })
    expect(badges).toHaveLength(2)
    expect(badges[0]!.closest('button')?.getAttribute('title')).toBe('No Recording output.')
  })
})
