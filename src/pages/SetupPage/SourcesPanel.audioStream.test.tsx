// @vitest-environment jsdom
/**
 * Edit Source "Audio stream" gating (studio#243, OL-45). The backend applies a
 * chosen audio stream for MPEG-TS/SRT only; EFP always uses the first stream,
 * so the dialog must not offer the control, discover streams, or PATCH a
 * non-zero index for EFP sources.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { sourcesApi, type AudioStreamsResponse } from '@/lib/api'
import { EFP_AUDIO_STREAM_NOTE } from '@/lib/audio-stream-index'
import { useSourcesStore, type Source } from '@/store/sources.store'
import { useGatewaysStore } from '@/store/gateways.store'
import { useProductionsStore } from '@/store/productions.store'
import { SourcesPanel } from './SourcesPanel'

vi.mock('@/hooks/useServerInfo', () => ({ refreshServerInfo: async () => {}, useServerInfo: () => ({ info: null, loaded: true }) }))
vi.mock('@/hooks/usePhoneLayout', () => ({ useIsPhone: () => false }))

type UpdateFields = Parameters<ReturnType<typeof useSourcesStore.getState>['updateSource']>[1]
const updateSource = vi.fn<(id: string, fields: UpdateFields) => Promise<void>>()
const audioStreams = vi.spyOn(sourcesApi, 'audioStreams')

function source(overrides: Partial<Source>): Source {
  return {
    id: 'src-1', name: 'Cam 1', address: 'srt://sender.example.com:9000?mode=caller',
    streamType: 'srt', status: 'active', color: '#fff', latency: 125, ...overrides,
  }
}

function renderWith(src: Source) {
  useSourcesStore.setState({ sources: [src], fetchAll: vi.fn(async () => {}), updateSource })
  render(<SourcesPanel />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  // Modal has no dialog role; the only other modals (New/Delete) are closed, so
  // the edit dialog is the Save button's enclosing modal panel.
  return screen.getByRole('button', { name: 'Save' }).closest('.rounded-xl') as HTMLElement
}

function save(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
}

beforeEach(() => {
  updateSource.mockReset().mockResolvedValue(undefined)
  audioStreams.mockReset()
  useGatewaysStore.setState({ gateways: [], fetchAll: vi.fn(async () => {}) })
  useProductionsStore.setState({ productions: [] })
})

afterEach(() => cleanup())

describe('SourcesPanel Edit — audio stream (OL-45)', () => {
  it('EFP: no control, shows the note, no discovery, no audioStreamIndex in the PATCH', () => {
    const dialog = renderWith(source({ streamType: 'efp' }))
    expect(dialog.querySelector('#edit-audio-stream')).toBeNull()
    expect(within(dialog).getByText(EFP_AUDIO_STREAM_NOTE)).toBeTruthy()
    expect(audioStreams).not.toHaveBeenCalled()
    save(dialog)
    expect(updateSource).toHaveBeenCalledTimes(1)
    expect(updateSource.mock.calls[0]![1]).not.toHaveProperty('audioStreamIndex')
  })

  it('EFP with a stale stored index: says it is ignored and clears it to 0 on Save', () => {
    const dialog = renderWith(source({ streamType: 'efp', audioStreamIndex: 2 }))
    expect(dialog.querySelector('#edit-audio-stream')).toBeNull()
    expect(within(dialog).getByText(/previously saved stream 2 is ignored/)).toBeTruthy()
    expect(audioStreams).not.toHaveBeenCalled()
    save(dialog)
    expect(updateSource.mock.calls[0]![1].audioStreamIndex).toBe(0)
  })

  it('SRT: still discovers streams, shows the control and PATCHes a changed index', async () => {
    const res: AudioStreamsResponse = {
      selectedIndex: 0,
      discovery: 'available',
      streams: [{ index: 0, codec: 'aac', channels: 2 }, { index: 1, codec: 'aac', channels: 2 }],
    }
    audioStreams.mockResolvedValue(res)
    const dialog = renderWith(source({ streamType: 'srt' }))
    expect(audioStreams).toHaveBeenCalledWith('src-1')
    expect(within(dialog).queryByText(EFP_AUDIO_STREAM_NOTE)).toBeNull()
    const select = await within(dialog).findByRole('combobox')
    expect(select.id).toBe('edit-audio-stream')
    fireEvent.change(select, { target: { value: '1' } })
    save(dialog)
    expect(updateSource.mock.calls[0]![1].audioStreamIndex).toBe(1)
  })
})
