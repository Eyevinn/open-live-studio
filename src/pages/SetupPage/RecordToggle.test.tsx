// @vitest-environment jsdom
/**
 * Per-source Record toggle (studio#233, OL-32 §2.3 / §8). The store action is
 * stubbed with the PUT's documented results and refusals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError, type SourceRecordResult } from '@/lib/api'
import {
  RECORD_APPLIES_NOTE,
  RECORD_LIVE_NOTE,
  RECORD_NO_OUTPUT_WARNING,
  RECORD_UNSUPPORTED_SOURCE,
} from '@/lib/input-recording'
import { useProductionsStore } from '@/store/productions.store'
import { RecordToggle } from './RecordToggle'

const setSourceRecord = vi.fn<(id: string, mixerInput: string, record: 'off' | 'transcode') => Promise<SourceRecordResult>>()

function result(overrides: Partial<SourceRecordResult> = {}): SourceRecordResult {
  return {
    mixerInput: 'video_in_1', sourceId: 'cam', record: 'transcode', appliesFrom: 'next-activation',
    currentlyRecording: false, recordingOutputAssigned: true, _rev: '3-a', ...overrides,
  }
}

type Props = Parameters<typeof RecordToggle>[0]
function renderToggle(overrides: Partial<Props> = {}) {
  const props: Props = {
    productionId: 'p1', mixerInput: 'video_in_1', sourceLabel: 'Cam 2', record: 'off', recordable: true,
    isLive: false, currentlyRecording: false, hasRecordingOutput: true, ...overrides,
  }
  return render(<RecordToggle {...props} />)
}

function checkbox(): HTMLInputElement {
  return screen.getByRole('checkbox', { name: 'Record Cam 2' }) as HTMLInputElement
}

beforeEach(() => {
  setSourceRecord.mockReset()
  useProductionsStore.setState({ setSourceRecord })
})

afterEach(() => cleanup())

describe('RecordToggle', () => {
  it('PUTs transcode and says it applies from the next activation', async () => {
    setSourceRecord.mockResolvedValueOnce(result())
    renderToggle()
    fireEvent.click(checkbox())
    expect(setSourceRecord).toHaveBeenCalledWith('p1', 'video_in_1', 'transcode')
    expect(await screen.findByText(RECORD_APPLIES_NOTE)).toBeTruthy()
  })

  it('PUTs off when turned off', async () => {
    setSourceRecord.mockResolvedValueOnce(result({ record: 'off' }))
    renderToggle({ record: 'transcode' })
    fireEvent.click(checkbox())
    expect(setSourceRecord).toHaveBeenCalledWith('p1', 'video_in_1', 'off')
    await screen.findByText(RECORD_APPLIES_NOTE)
  })

  it('shows the next-activation note whenever the toggle is on, before any change', () => {
    renderToggle({ record: 'transcode' })
    expect(screen.getByText(RECORD_APPLIES_NOTE)).toBeTruthy()
  })

  it('shows no note while the toggle is off and untouched', () => {
    renderToggle()
    expect(screen.queryByText(RECORD_APPLIES_NOTE)).toBeNull()
  })

  it('uses the live note while the production is live', async () => {
    setSourceRecord.mockResolvedValueOnce(result())
    renderToggle({ isLive: true })
    fireEvent.click(checkbox())
    expect(await screen.findByText(RECORD_LIVE_NOTE)).toBeTruthy()
  })

  it('warns when recordingOutputAssigned is false (AC 3)', async () => {
    setSourceRecord.mockResolvedValueOnce(result({ recordingOutputAssigned: false }))
    const { rerender } = renderToggle()
    fireEvent.click(checkbox())
    await screen.findByText(RECORD_APPLIES_NOTE)
    // The store now holds record: transcode.
    rerender(<RecordToggle productionId="p1" mixerInput="video_in_1" sourceLabel="Cam 2" record="transcode" recordable isLive={false} currentlyRecording={false} hasRecordingOutput />)
    expect(screen.getByText(RECORD_NO_OUTPUT_WARNING)).toBeTruthy()
  })

  it('warns before any change when recording is on and no Recording output is assigned', () => {
    renderToggle({ record: 'transcode', hasRecordingOutput: false })
    expect(screen.getByText(RECORD_NO_OUTPUT_WARNING)).toBeTruthy()
  })

  it('shows 409 record-cap-reached inline', async () => {
    setSourceRecord.mockRejectedValueOnce(new ApiError('At most 2 inputs can be recorded', 409, {
      error: 'At most 2 inputs can be recorded', statusCode: 409, reason: 'record-cap-reached',
    }))
    renderToggle()
    fireEvent.click(checkbox())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('At most 2 inputs can be recorded')
    await waitFor(() => expect(checkbox().disabled).toBe(false))
  })

  it('shows 400 record-source-unsupported inline', async () => {
    setSourceRecord.mockRejectedValueOnce(new ApiError('Unsupported', 400, { reason: 'record-source-unsupported' }))
    renderToggle()
    fireEvent.click(checkbox())
    expect((await screen.findByRole('alert')).textContent).toContain(RECORD_UNSUPPORTED_SOURCE)
  })

  it('is disabled for a source that cannot record', () => {
    renderToggle({ recordable: false })
    expect(checkbox().disabled).toBe(true)
    expect(screen.getByText(RECORD_UNSUPPORTED_SOURCE)).toBeTruthy()
  })

  it('is disabled until the assignment is stored', () => {
    renderToggle({ record: null })
    expect(checkbox().disabled).toBe(true)
  })

  it('says when the running activation records the input', () => {
    renderToggle({ record: 'transcode', isLive: true, currentlyRecording: true })
    expect(screen.getByText('Recording now')).toBeTruthy()
  })
})
