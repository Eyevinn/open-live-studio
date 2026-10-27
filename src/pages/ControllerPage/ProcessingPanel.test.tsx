// @vitest-environment jsdom
/**
 * Component tests for the channel-strip / main-bus processing slide-over
 * (studio#231, OL-25b). The REST seed is mocked; the coalescer, store and
 * panel run unchanged, and the WS `send` is a spy, so these assert exactly
 * which AUDIO_PROC_SET frames would reach the controller socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ProcSetMessage } from '@/lib/audio-processing'
import { ProcSetCoalescer } from '@/lib/audio-proc-sender'
import { useAudioProcessingStore } from '@/store/audioProcessing.store'

const getProcessing = vi.fn()
vi.mock('@/lib/api', () => ({ audioApi: { getProcessing: (...a: unknown[]) => getProcessing(...a) } }))

const { ProcessingPanel } = await import('./ProcessingPanel')

let sent: ProcSetMessage[]
let coalescer: ProcSetCoalescer

function renderPanel(elementId: string, label: string) {
  return render(<ProcessingPanel elementId={elementId} label={label} coalescer={coalescer} onClose={() => {}} />)
}

beforeEach(() => {
  sent = []
  let n = 0
  coalescer = new ProcSetCoalescer({
    send: (m) => sent.push(m),
    makeCmdId: () => `c${++n}`,
    onSent: (cmdId, elementId, stage, params) => useAudioProcessingStore.getState().registerPending(cmdId, elementId, stage, params),
  })
  useAudioProcessingStore.getState().reset('p1')
  getProcessing.mockReset().mockResolvedValue({ element_id: 'ch1', processing: { gain: { gain: 4 } } })
})
afterEach(() => { cleanup(); coalescer.dispose() })

describe('ProcessingPanel', () => {
  it('shows the channel stages, seeded from GET .../processing', async () => {
    renderPanel('ch1', 'CAM 1')
    for (const name of ['Input gain', 'High-pass', 'Gate', 'Compressor', 'EQ']) {
      expect(screen.getByRole('region', { name })).toBeTruthy()
    }
    expect(screen.queryByRole('region', { name: 'Limiter' })).toBeNull()
    expect(getProcessing).toHaveBeenCalledWith('p1', 'ch1')
    const gain = within(screen.getByRole('region', { name: 'Input gain' })).getByLabelText('Gain') as HTMLInputElement
    await vi.waitFor(() => expect(gain.value).toBe('4.0'))
    expect(screen.getByText(/High-pass on\/off applies on the next activation/)).toBeTruthy()
  })

  it('main bus shows compressor, EQ and limiter with the pre-fader note', () => {
    renderPanel('main', 'MAIN')
    expect(screen.queryByRole('region', { name: 'Gate' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Limiter' })).toBeTruthy()
    const note = screen.getByText(/acts before the master fader/)
    expect(note.textContent).toBe('The limiter currently acts before the master fader, so raising the master can still clip.')
    expect(note.textContent).not.toMatch(/strom#|Eyevinn\//)
  })

  it('enabling the compressor sends AUDIO_PROC_SET and reset sends the defaults', () => {
    renderPanel('ch1', 'CAM 1')
    const comp = within(screen.getByRole('region', { name: 'Compressor' }))
    fireEvent.click(comp.getByRole('button', { name: 'Off' }))
    expect(sent.at(-1)).toEqual({ type: 'AUDIO_PROC_SET', elementId: 'ch1', stage: 'comp', params: { enabled: true }, cmdId: 'c1' })
    expect(comp.getByRole('button', { name: 'On' })).toBeTruthy()

    act(() => { coalescer.dispose() }) // flush the throttle window for the next frame
    fireEvent.click(comp.getByRole('button', { name: /Reset/ }))
    act(() => { coalescer.dispose() })
    expect(sent.at(-1)?.params).toEqual({ enabled: false, threshold: -20, ratio: 4, attack: 10, release: 100, makeup: 0, knee: -6 })
  })

  it('an out-of-range number cannot be sent', () => {
    renderPanel('ch1', 'CAM 1')
    const gain = within(screen.getByRole('region', { name: 'Input gain' })).getByLabelText('Gain')
    fireEvent.change(gain, { target: { value: '35' } })
    fireEvent.keyDown(gain, { key: 'Enter' })
    fireEvent.blur(gain)
    expect(sent).toHaveLength(0)
    expect(screen.getByRole('alert').textContent).toMatch(/-20 to 20 dB — not sent/)
  })

  it('a server rejection shows on the stage and reverts the control', () => {
    useAudioProcessingStore.getState().applyState({ elementId: 'ch1', stage: 'comp', params: { threshold: -30 }, applied: true })
    renderPanel('ch1', 'CAM 1')
    const comp = within(screen.getByRole('region', { name: 'Compressor' }))
    const threshold = comp.getByLabelText('Threshold') as HTMLInputElement
    fireEvent.change(threshold, { target: { value: '-12' } })
    fireEvent.keyDown(threshold, { key: 'Enter' })
    expect(sent.at(-1)?.params).toEqual({ threshold: -12 })
    expect(threshold.value).toBe('-12.0')

    act(() => { useAudioProcessingStore.getState().nack(sent.at(-1)!.cmdId!, 'Audio processing: Strom refused the write') })
    expect(comp.getByRole('alert').textContent).toBe('Audio processing: Strom refused the write')
    expect(threshold.value).toBe('-30.0')
    expect(threshold.getAttribute('aria-invalid')).toBe('true')
  })

  it('a rejection that lands mid-drag re-syncs the slider on release', () => {
    useAudioProcessingStore.getState().applyState({ elementId: 'ch1', stage: 'comp', params: { threshold: -30 }, applied: true })
    renderPanel('ch1', 'CAM 1')
    const comp = within(screen.getByRole('region', { name: 'Compressor' }))
    const slider = comp.getByLabelText('Threshold slider') as HTMLInputElement
    const threshold = comp.getByLabelText('Threshold') as HTMLInputElement
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '900' } })
    const cmdId = sent.at(-1)!.cmdId!
    const dragged = threshold.value
    expect(dragged).not.toBe('-30.0')

    act(() => { useAudioProcessingStore.getState().nack(cmdId, 'no') })
    // Still dragging: the control keeps the drag position.
    expect(threshold.value).toBe(dragged)
    fireEvent.pointerUp(slider)
    expect(threshold.value).toBe('-30.0')
    expect(useAudioProcessingStore.getState().known.ch1?.comp?.threshold).toBe(-30)
  })

  it('renders a second operator\'s change live', () => {
    renderPanel('ch1', 'CAM 1')
    act(() => {
      useAudioProcessingStore.getState().applyState({ elementId: 'ch1', stage: 'eq', params: { enabled: true, bands: [{ band: 2, gain: -6 }] }, applied: true })
    })
    const eq = within(screen.getByRole('region', { name: 'EQ' }))
    expect(eq.getByRole('button', { name: 'On' })).toBeTruthy()
    const gains = eq.getAllByLabelText('Gain') as HTMLInputElement[]
    expect(gains.map((g) => g.value)).toEqual(['0.0', '-6.0', '0.0', '0.0'])
  })
})
