import { useEffect, useState } from 'react'
import type { SourceRecordResult } from '@/lib/api'
import {
  RECORD_APPLIES_NOTE,
  RECORD_LIVE_NOTE,
  RECORD_NO_OUTPUT_WARNING,
  RECORD_UNSUPPORTED_SOURCE,
  sourceRecordErrorMessage,
} from '@/lib/input-recording'
import { useProductionsStore } from '@/store/productions.store'

interface Props {
  productionId: string
  /** Stored assignment key the toggle writes (`PUT .../sources/:mixerInput/record`). */
  mixerInput: string
  /** Name shown in the accessible label. */
  sourceLabel: string
  /** Current `record` of the stored assignment; absent = off. Null while the assignment is not stored yet. */
  record: 'off' | 'transcode' | null
  /** False for test, HTML and clip sources: only WHIP/SRT/EFP can record. */
  recordable: boolean
  /** The production is live: a change applies from the next activation. */
  isLive: boolean
  /** Whether the running activation records this input (`inputRecordings`). */
  currentlyRecording: boolean
  /** Whether a Recording output is assigned now (the Outputs list of this dialog). */
  hasRecordingOutput: boolean
}

/**
 * Per-source Record toggle (studio#233, OL-32): records this input to its own
 * files beside the program recording. The setting is read at activation, so
 * the toggle says it applies from the next activation, warns when no
 * Recording output is assigned, and shows refusals (unsupported source, cap
 * reached) inline.
 */
export function RecordToggle({
  productionId, mixerInput, sourceLabel, record, recordable, isLive, currentlyRecording, hasRecordingOutput,
}: Props) {
  const setSourceRecord = useProductionsStore((s) => s.setSourceRecord)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SourceRecordResult | null>(null)

  // `recordingOutputAssigned` describes the outputs at the time of the PUT;
  // once the Outputs list changes, the live check takes over.
  useEffect(() => { setResult((r) => (r ? { ...r, recordingOutputAssigned: hasRecordingOutput } : r)) }, [hasRecordingOutput])

  const on = record === 'transcode'
  const noOutput = on && !(result ? result.recordingOutputAssigned : hasRecordingOutput)
  const id = `record-${productionId}-${mixerInput}`

  async function toggle(next: boolean) {
    setBusy(true)
    setError(null)
    try {
      setResult(await setSourceRecord(productionId, mixerInput, next ? 'transcode' : 'off'))
    } catch (err) {
      setError(sourceRecordErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-0.5 pl-1">
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          className="accent-red-500"
          checked={on}
          disabled={busy || record === null || (!recordable && !on)}
          aria-label={`Record ${sourceLabel}`}
          title={!recordable ? RECORD_UNSUPPORTED_SOURCE : undefined}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <label htmlFor={id} className={`text-[10px] ${recordable ? 'text-[--color-text-muted]' : 'text-[--color-text-muted] opacity-60'}`}>
          Record this input
        </label>
        {isLive && currentlyRecording && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-red-400">Recording now</span>
        )}
        {busy && <span className="text-[10px] text-[--color-accent]">Saving…</span>}
      </div>
      {!recordable && !on && <p className="text-[10px] text-[--color-text-muted] italic">{RECORD_UNSUPPORTED_SOURCE}</p>}
      {error && <p role="alert" className="text-[10px] text-red-400">{error}</p>}
      {/* With the toggle (#233 scope 1): the setting is read at activation. */}
      {(on || result?.appliesFrom === 'next-activation') && (
        <p role="note" className="text-[10px] text-[--color-text-muted]">{isLive ? RECORD_LIVE_NOTE : RECORD_APPLIES_NOTE}</p>
      )}
      {noOutput && <p role="alert" className="text-[10px] text-amber-400">{RECORD_NO_OUTPUT_WARNING}</p>}
    </div>
  )
}
