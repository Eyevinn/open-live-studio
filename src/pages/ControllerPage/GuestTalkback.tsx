import type { KeyboardEvent, PointerEvent } from 'react'
import { cn } from '@/lib/cn'
import { useIntercomStore } from '@/store/intercom.store'
import { supportsSetSinkId, type GuestTalkbackView, type TalkbackManager } from '@/lib/talkback-manager'

// ─── Operator talkback UI (studio#237, guest-talkback spec §5.2 / OLS-A) ───────

function MicGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
    </svg>
  )
}

const chip = 'inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest border px-1.5 py-0.5 rounded shrink-0 transition-colors'

/**
 * The guest row's "Talkback" chip, now the open/close control. Rendered only
 * when the guest has an `intercomLine`.
 */
export function TalkbackChip({
  guestName,
  intercomLine,
  view,
  disabled,
  onOpen,
  onClose,
}: {
  guestName: string
  intercomLine: string
  view: GuestTalkbackView | undefined
  disabled: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const isOpen = view?.status === 'open' || view?.status === 'connecting'
  const title = disabled
    ? `Talkback line available (${intercomLine}). Activate the production to talk to ${guestName}.`
    : isOpen
      ? `Close talkback to ${guestName}`
      : `Open talkback to ${guestName} (line ${intercomLine})`
  return (
    <button
      type="button"
      onClick={isOpen ? onClose : onOpen}
      disabled={disabled}
      aria-pressed={isOpen}
      title={title}
      aria-label={title}
      className={cn(
        chip,
        disabled
          ? 'text-sky-300/50 border-sky-900 bg-sky-950/20 cursor-not-allowed'
          : isOpen
            ? 'text-black border-sky-300 bg-sky-400 hover:brightness-110 cursor-pointer'
            : 'text-sky-300 border-sky-800 bg-sky-950/40 hover:border-sky-500 cursor-pointer',
      )}
    >
      <MicGlyph />
      Talkback
    </button>
  )
}

/**
 * Talk / Latch / Listen / Close row for a guest whose talkback is connecting,
 * open, or failed. Talk is push-to-talk (hold); Latch keeps it on (one guest at
 * a time — latching another guest releases the first).
 */
export function TalkbackControls({
  guestName,
  view,
  manager,
  guestId,
}: {
  guestName: string
  view: GuestTalkbackView
  manager: TalkbackManager
  guestId: string
}) {
  if (view.status === 'unavailable') {
    return (
      <div className="flex items-center gap-1.5">
        <span role="status" title={view.error} className="text-[9px] font-bold uppercase tracking-widest text-amber-400 flex-1 min-w-0 truncate">
          Talkback unavailable
        </span>
        <button
          type="button"
          onClick={() => { void manager.open(guestId) }}
          className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-200 cursor-pointer px-1 shrink-0"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={() => { void manager.close(guestId) }}
          aria-label={`Dismiss talkback error for ${guestName}`}
          title="Dismiss"
          className="text-zinc-600 hover:text-zinc-300 cursor-pointer text-[11px] leading-none px-1 shrink-0"
        >
          ✕
        </button>
      </div>
    )
  }

  const connecting = view.status === 'connecting'
  const press = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    manager.press(guestId)
  }
  const release = () => manager.release(guestId)
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault()
      manager.press(guestId)
    }
  }
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      release()
    }
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-600 shrink-0">Talkback</span>
      <button
        type="button"
        disabled={connecting}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={release}
        onContextMenu={(e) => e.preventDefault()}
        aria-pressed={view.talking}
        aria-label={`Talk to ${guestName} (hold)`}
        title={connecting ? 'Connecting talkback…' : `Hold to talk to ${guestName}`}
        className={cn(
          'btn-hardware px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors select-none touch-none',
          connecting
            ? 'bg-zinc-900 text-zinc-700 border-zinc-800 cursor-wait'
            : view.talking
              ? 'bg-red-600 text-white border-red-400 cursor-pointer'
              : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500 cursor-pointer',
        )}
      >
        {connecting ? 'Connecting…' : view.talking ? 'Talking' : 'Talk'}
      </button>
      <button
        type="button"
        disabled={connecting}
        onClick={() => manager.toggleLatch(guestId)}
        aria-pressed={view.latched}
        aria-label={`Latch talk to ${guestName}`}
        title={view.latched ? 'Unlatch talk' : 'Latch talk on (only one guest at a time)'}
        className={cn(
          'btn-hardware px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors',
          connecting
            ? 'bg-zinc-900 text-zinc-700 border-zinc-800 cursor-wait'
            : view.latched
              ? 'bg-orange-500 text-black border-orange-400 cursor-pointer'
              : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200 hover:border-zinc-500 cursor-pointer',
        )}
      >
        Latch
      </button>
      <button
        type="button"
        onClick={() => manager.setListening(guestId, !view.listening)}
        aria-pressed={view.listening}
        aria-label={`Listen to ${guestName}`}
        title={view.listening ? 'Mute this guest’s talkback line' : 'Listen to this guest’s talkback line'}
        className={cn(
          'btn-hardware px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors cursor-pointer',
          view.listening
            ? 'bg-sky-900/60 text-sky-200 border-sky-700'
            : 'bg-zinc-900 text-zinc-500 border-zinc-700 line-through',
        )}
      >
        Listen
      </button>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => { void manager.close(guestId) }}
        aria-label={`Close talkback to ${guestName}`}
        title="Close talkback"
        className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-200 cursor-pointer px-1 shrink-0"
      >
        Close
      </button>
    </div>
  )
}

/** Mic (and, where `setSinkId` is supported, output) picker for talkback, in the Guests panel header. */
export function TalkbackDevicePicker() {
  const micDeviceId = useIntercomStore((s) => s.micDeviceId)
  const availableDevices = useIntercomStore((s) => s.availableDevices)
  const setMicDeviceId = useIntercomStore((s) => s.setMicDeviceId)
  const outputDeviceId = useIntercomStore((s) => s.outputDeviceId)
  const availableOutputDevices = useIntercomStore((s) => s.availableOutputDevices)
  const setOutputDeviceId = useIntercomStore((s) => s.setOutputDeviceId)
  const showOutput = supportsSetSinkId() && availableOutputDevices.length > 0
  const select = 'flex-1 min-w-0 text-[9px] cursor-pointer bg-zinc-900 border border-zinc-700 text-zinc-400 px-1 py-0.5 focus:outline-none focus:border-orange-500'

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-600 shrink-0">Mic</span>
      <select
        value={micDeviceId ?? ''}
        onChange={(e) => setMicDeviceId(e.target.value || null)}
        aria-label="Talkback microphone"
        className={select}
      >
        <option value="">System default</option>
        {availableDevices.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
        ))}
      </select>
      {showOutput && (
        <>
          <span className="text-[8px] font-bold uppercase tracking-widest text-zinc-600 shrink-0">Out</span>
          <select
            value={outputDeviceId ?? ''}
            onChange={(e) => setOutputDeviceId(e.target.value || null)}
            aria-label="Talkback output device"
            className={select}
          >
            <option value="">System default</option>
            {availableOutputDevices.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${i + 1}`}</option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}
