import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { useProductionStore, type ClipPlaybackState } from '@/store/production.store'
import type { OutboundMessage } from '@/hooks/useControllerWs'

// ─── Clip cueing / playback operator UI (epic open-live#206, studio#145) ────────
//
// A manual operator surface over the shipped controller-WS clip contract:
//   outbound CLIP_CUE / CLIP_PLAY / CLIP_PAUSE / CLIP_STOP / CLIP_SEEK
//   inbound  CLIP_STATE (state machine idle → cued → playing → paused/stopped →
//            completed, plus error), kept in production.store `clipStates`.
//
// Cueing is a pure preload (OQ4): it never seizes PGM/PVW. Taking a cued clip to
// air is the existing source-selection path in the vision-mixer controller.

/** Human labels + accent colours for each clip playback state. */
const STATE_META: Record<ClipPlaybackState, { label: string; className: string }> = {
  idle:      { label: 'Idle',      className: 'text-zinc-500' },
  cued:      { label: 'Cued',      className: 'text-sky-400' },
  playing:   { label: 'Playing',   className: 'text-green-400' },
  paused:    { label: 'Paused',    className: 'text-amber-400' },
  stopped:   { label: 'Stopped',   className: 'text-zinc-400' },
  completed: { label: 'Completed', className: 'text-zinc-400' },
  error:     { label: 'Error',     className: 'text-red-400' },
}

/** Formats a millisecond position as m:ss (or -:-- when unknown). */
function formatMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '-:--'
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

interface ClipButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  title?: string
}

function ClipButton({ label, onClick, disabled, active, title }: ClipButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'btn-hardware px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest border transition-colors',
        disabled
          ? 'bg-zinc-900 text-zinc-700 border-zinc-800 cursor-not-allowed'
          : active
            ? 'bg-orange-500 text-black border-orange-400 cursor-pointer'
            : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:text-white hover:border-zinc-500 cursor-pointer',
      )}
    >
      {label}
    </button>
  )
}

/** A scrub/seek bar bound to a clip's live position; commits on release. */
function ScrubBar({
  positionMs,
  durationMs,
  disabled,
  onSeek,
}: {
  positionMs: number | undefined
  durationMs: number | undefined
  disabled: boolean
  onSeek: (positionMs: number) => void
}) {
  const hasDuration = typeof durationMs === 'number' && durationMs > 0
  const serverValue = hasDuration ? Math.min(positionMs ?? 0, durationMs) : 0
  // Local draft while dragging so the thumb doesn't fight incoming CLIP_STATE.
  const [dragValue, setDragValue] = useState<number | null>(null)
  const isDraggingRef = useRef(false)

  useEffect(() => {
    if (!isDraggingRef.current) setDragValue(null)
  }, [serverValue])

  const value = dragValue ?? serverValue

  return (
    <input
      type="range"
      min={0}
      max={hasDuration ? durationMs : 0}
      step={100}
      value={value}
      disabled={disabled || !hasDuration}
      aria-label="Clip position"
      onChange={(e) => {
        isDraggingRef.current = true
        setDragValue(Number(e.target.value))
      }}
      onPointerUp={() => {
        if (dragValue !== null) onSeek(dragValue)
        isDraggingRef.current = false
        setDragValue(null)
      }}
      onKeyUp={() => {
        if (dragValue !== null) onSeek(dragValue)
        isDraggingRef.current = false
        setDragValue(null)
      }}
      className={cn(
        'flex-1 h-1 accent-orange-500',
        disabled || !hasDuration ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      )}
    />
  )
}

interface ClipRowProps {
  mixerInput: string
  name: string
  send: (msg: OutboundMessage) => void
}

function ClipRow({ mixerInput, name, send }: ClipRowProps) {
  const clip = useProductionStore((s) => s.clipStates[mixerInput])
  const state: ClipPlaybackState = clip?.state ?? 'idle'
  const meta = STATE_META[state]

  const isLoaded = state !== 'idle'
  const isPlaying = state === 'playing'
  const canPlay = state === 'cued' || state === 'paused' || state === 'stopped' || state === 'completed'
  // Seeking is meaningful once a clip is loaded (not idle) and not in an error state.
  const canSeek = isLoaded && state !== 'error'

  return (
    <div className="flex flex-col gap-1 border border-zinc-800 bg-zinc-950 px-2.5 py-2">
      {/* Header: source name + live state */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-300 truncate flex-1 min-w-0">
          {name}
        </span>
        <span className={cn('text-[9px] font-bold uppercase tracking-widest shrink-0', meta.className)}>
          {meta.label}
        </span>
      </div>

      {/* Error message, when present */}
      {state === 'error' && clip?.error && (
        <span className="text-[9px] text-red-400/90 leading-snug break-words">{clip.error}</span>
      )}

      {/* Transport controls */}
      <div className="flex items-center gap-1">
        <ClipButton
          label="Cue"
          title="Preload this clip (preview-ready, does not go to air)"
          active={state === 'cued'}
          onClick={() => send({ type: 'CLIP_CUE', mixerInput })}
        />
        <ClipButton
          label="Play"
          title="Play the cued clip"
          disabled={!canPlay}
          active={isPlaying}
          onClick={() => send({ type: 'CLIP_PLAY', mixerInput })}
        />
        <ClipButton
          label="Pause"
          title="Pause playback"
          disabled={!isPlaying}
          onClick={() => send({ type: 'CLIP_PAUSE', mixerInput })}
        />
        <ClipButton
          label="Stop"
          title="Stop playback and clear the cue"
          disabled={!isLoaded}
          onClick={() => send({ type: 'CLIP_STOP', mixerInput })}
        />
      </div>

      {/* Scrub + position/duration readout */}
      <div className="flex items-center gap-2">
        <ScrubBar
          positionMs={clip?.positionMs}
          durationMs={clip?.durationMs}
          disabled={!canSeek}
          onSeek={(positionMs) => send({ type: 'CLIP_SEEK', mixerInput, positionMs })}
        />
        <span className="text-[9px] font-mono tabular-nums text-zinc-500 shrink-0">
          {formatMs(clip?.positionMs)} / {formatMs(clip?.durationMs)}
        </span>
      </div>
    </div>
  )
}

interface ClipPanelProps {
  /** Clip-type sources assigned to this production, in display order. */
  clips: Array<{ mixerInput: string; name: string }>
  send: (msg: OutboundMessage) => void
}

export function ClipPanel({ clips, send }: ClipPanelProps) {
  if (clips.length === 0) {
    return (
      <p className="text-[9px] text-zinc-600 px-1 py-2">
        No clip sources assigned to this production.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {clips.map((clip) => (
        <ClipRow key={clip.mixerInput} mixerInput={clip.mixerInput} name={clip.name} send={send} />
      ))}
    </div>
  )
}
