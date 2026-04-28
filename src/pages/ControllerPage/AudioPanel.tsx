import { useRef, useCallback } from 'react'
import { useAudioStore } from '@/store/audio.store'
import { useProductionStore } from '@/store/production.store'
import { cn } from '@/lib/cn'
import type { OutboundMessage } from '@/hooks/useControllerWs'

type SendFn = (msg: OutboundMessage) => void

const FADER_H = 160
const TICK_COUNT = 13

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconGear() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
      <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
    </svg>
  )
}

function IconSpeaker() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
      <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
      <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/>
      <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/>
    </svg>
  )
}

// ── VU Meter — PPM-style segmented ────────────────────────────────────────────

const DB_MIN = -60
const DB_MAX = 0

function dbToRatio(db: number): number {
  return Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN)))
}

function barColor(ratio: number): string {
  if (ratio > 0.9) return '#ff2020'   // clip zone — red
  if (ratio > 0.7) return '#ffcc00'   // above nominal — amber
  return '#00bb44'                     // nominal — green
}

function VuMeter({ elementId }: { elementId: string }) {
  const meter = useAudioStore((s) => s.meters[elementId])
  const channels = meter
    ? meter.peak.map((peak, i) => ({ bar: peak, hold: meter.decay?.[i] ?? peak }))
    : [{ bar: DB_MIN, hold: DB_MIN }]

  return (
    <div style={{ width: channels.length > 1 ? 14 : 7, height: FADER_H, display: 'flex', gap: 2, flexShrink: 0 }}>
      {channels.map(({ bar, hold }, i) => {
        const barR  = dbToRatio(bar)
        const holdR = dbToRatio(hold)
        const color = barColor(barR)
        return (
          <div key={i} style={{ flex: 1, position: 'relative', background: '#0a0a0a', border: '1px solid #222' }}>
            {/* PPM bar — classic segmented appearance */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: `${barR * 100}%`,
                background: `linear-gradient(to top, ${color} 0%, ${color} 60%, ${barR > 0.9 ? '#ff5050' : barR > 0.7 ? '#ffe050' : '#22ee66'} 100%)`,
                transition: 'height 80ms linear',
              }}
            />
            {/* Segment dividers — PPM tick lines */}
            <div
              className="vu-segment-bar"
            />
            {/* Peak hold indicator */}
            <div style={{
              position: 'absolute',
              bottom: `${holdR * 100}%`,
              left: 0,
              right: 0,
              height: 2,
              background: holdR > 0.9 ? '#ff4040' : '#ffffff88',
            }} />
          </div>
        )
      })}
    </div>
  )
}

// ── Fader taper ───────────────────────────────────────────────────────────────
// Broadcast-standard log taper: pos 1.0 → 0 dB, pos 0.75 → −10 dB, pos 0.5 → −20 dB.

function faderToVolume(pos: number): number {
  if (pos <= 0) return 0
  return Math.min(Math.pow(0.01, 1 - pos), 0.9999)
}

function volumeToFader(vol: number): number {
  if (vol <= 0) return 0
  return Math.max(0, 1 + Math.log10(vol) / 2)
}

// ── Channel strip ─────────────────────────────────────────────────────────────

function ChannelStrip({ elementId, label, send, showMute = true, isPgm = false, isPvw = false }: {
  elementId: string
  label: string
  send: SendFn
  showMute?: boolean
  isPgm?: boolean
  isPvw?: boolean
}) {
  const level = useAudioStore((s) => s.levels[elementId] ?? 1.0)
  const muted = useAudioStore((s) => s.muted[elementId] ?? false)
  const setLevel = useAudioStore((s) => s.setLevel)
  const toggleMute = useAudioStore((s) => s.toggleMute)

  const throttleRef = useRef<{ timer: ReturnType<typeof setTimeout>; last: number } | null>(null)
  const atFloorRef = useRef(false)

  const handleChange = useCallback((faderPos: number) => {
    const volume = faderToVolume(faderPos)
    setLevel(elementId, volume)

    // Auto-mute when fader hits floor; unmute on any fader movement above floor
    const nowAtFloor = faderPos <= 0.02
    if (nowAtFloor && !atFloorRef.current) {
      atFloorRef.current = true
      if (!muted) {
        toggleMute(elementId)
        send({ type: 'AUDIO_SET', elementId, property: 'mute', value: true })
      }
    } else if (!nowAtFloor) {
      if (atFloorRef.current) atFloorRef.current = false
      if (muted) {
        toggleMute(elementId)
        send({ type: 'AUDIO_SET', elementId, property: 'mute', value: false })
      }
    }

    // At floor: mute already handles silence — cancel any pending volume PATCH and bail.
    if (nowAtFloor) {
      if (throttleRef.current) {
        clearTimeout(throttleRef.current.timer)
        throttleRef.current = null
      }
      return
    }

    // Trailing debounce: send only the final value after the drag settles.
    // Leading+trailing throttle was sending two overlapping PATCHes at the extremes,
    // which caused Strom to close the connection mid-request.
    if (throttleRef.current) clearTimeout(throttleRef.current.timer)
    const timer = setTimeout(() => {
      throttleRef.current = null
      send({ type: 'AUDIO_SET', elementId, property: 'volume', value: volume })
    }, 80)
    throttleRef.current = { timer, last: volume }
  }, [elementId, muted, send, setLevel, toggleMute])

  const handleMute = useCallback(() => {
    const next = !muted
    toggleMute(elementId)
    send({ type: 'AUDIO_SET', elementId, property: 'mute', value: next })
  }, [elementId, muted, send, toggleMute])

  // Strip width is fixed — tight broadcast layout
  const STRIP_W = 68

  return (
    <div
      className={cn(
        'flex flex-col shrink-0 select-none border-r border-zinc-800',
        isPgm ? 'ring-1 ring-inset ring-red-600' : isPvw ? 'ring-1 ring-inset ring-green-600' : '',
      )}
      style={{ width: STRIP_W, background: '#0d0d0d' }}
    >
      {/* Channel label header */}
      <div
        className="px-1 py-0.5 text-center border-b border-zinc-800 shrink-0"
        style={{ background: isPgm ? 'rgba(255,0,0,0.15)' : isPvw ? 'rgba(0,204,0,0.12)' : 'rgba(0,0,0,0.5)' }}
      >
        <span
          className="text-[9px] font-bold tracking-widest uppercase truncate block"
          style={{ color: isPgm ? '#ff4040' : isPvw ? '#00cc00' : '#f97316' }}
        >
          {label}
        </span>
      </div>

      {/* Main body — buttons | meter | fader */}
      <div className="flex gap-1 px-1 py-2 flex-1">

        {/* Left: action buttons — compact stacked */}
        <div className="flex flex-col gap-1 items-center shrink-0">
          <button
            title="Settings"
            className="w-5 h-5 bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-500 hover:text-orange-500 hover:border-zinc-500 transition-colors"
          >
            <IconGear />
          </button>
          <button
            title="Solo"
            className="w-5 h-5 bg-zinc-900 border border-zinc-700 flex items-center justify-center text-[8px] font-bold text-zinc-500 hover:text-yellow-400 hover:border-zinc-500 transition-colors"
          >
            S
          </button>
          <button
            title="Info"
            className="w-5 h-5 bg-zinc-900 border border-zinc-700 flex items-center justify-center text-[8px] font-bold text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            i
          </button>
          {/* Speaker / monitor button */}
          {showMute && (
            <button
              title={muted ? 'Unmute' : 'Mute'}
              onClick={handleMute}
              className={cn(
                'w-5 h-5 border flex items-center justify-center transition-colors',
                muted
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-600'
                  : 'border-green-700 text-green-400 hover:border-green-500',
              )}
              style={!muted ? { background: 'rgba(0,187,68,0.15)' } : {}}
            >
              <IconSpeaker />
            </button>
          )}
        </div>

        {/* VU meter */}
        <VuMeter elementId={elementId} />

        {/* Fader + tick marks */}
        <div className="flex-1 flex items-center justify-center">
          <div className="relative overflow-hidden" style={{ width: 20, height: FADER_H }}>
            {/* Track line */}
            <div
              className="absolute pointer-events-none"
              style={{
                width: 2,
                height: FADER_H,
                top: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#1a1a1a',
                border: '1px solid #2a2a2a',
              }}
            />
            {/* Tick marks */}
            <div
              className="absolute flex flex-col justify-between pointer-events-none"
              style={{ left: 12, top: 0, height: FADER_H, zIndex: 0 }}
            >
              {Array.from({ length: TICK_COUNT }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: i % 4 === 0 ? 6 : 3,
                    height: 1,
                    background: i % 4 === 0 ? '#3a3a3a' : '#252525',
                  }}
                />
              ))}
            </div>
            {/* Rotated range input — fader cap */}
            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={volumeToFader(level)}
              onChange={(e) => handleChange(parseFloat(e.target.value))}
              aria-label={`${label} fader`}
              className="fader-rotated"
              style={{
                width: FADER_H,
                height: 20,
                left: -(FADER_H - 20) / 2,
                top: (FADER_H - 20) / 2,
                cursor: muted ? 'not-allowed' : 'pointer',
                zIndex: 1,
              }}
            />
          </div>
        </div>
      </div>

      {/* Mute button — bottom strip */}
      {showMute && (
        <div className="border-t border-zinc-800 px-1 py-1 shrink-0">
          <button
            onClick={handleMute}
            className={cn(
              'btn-hardware w-full py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors',
              muted
                ? 'bg-red-700 text-white border-red-500'
                : 'bg-zinc-900 text-zinc-500 border-zinc-700 hover:text-zinc-300',
            )}
          >
            M
          </button>
        </div>
      )}
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function AudioPanel({ send }: { send: SendFn }) {
  const elements = useAudioStore((s) => s.elements)
  const pgmInput = useProductionStore((s) => s.pgmInput)
  const pvwInput = useProductionStore((s) => s.pvwInput)

  const mainElement = elements.find((e) => e.elementId === 'main')
  const inputElements = elements.filter((e) => e.elementId !== 'main' && e.mixerInput !== null)

  const hasContent = elements.length > 0

  return (
    <div
      className="border border-zinc-800 overflow-hidden flex items-stretch w-full"
      style={{ background: '#0d0d0d' }}
    >
      {!hasContent ? (
        <div className="flex items-center justify-center min-h-[160px] px-4">
          <p className="text-[9px] text-zinc-700 text-center uppercase tracking-widest">NO CHANNELS</p>
        </div>
      ) : (
        <>
          {/* OUTPUTS section label + MAIN strip */}
          <div className="flex items-stretch shrink-0">
            <div
              className="flex items-center justify-center shrink-0 border-r border-zinc-800"
              style={{ width: 16, background: 'rgba(249,115,22,0.08)' }}
            >
              <span
                className="text-[8px] font-bold tracking-widest uppercase whitespace-nowrap"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: '#f97316' }}
              >
                OUT
              </span>
            </div>
            {mainElement ? (
              <ChannelStrip elementId="main" label="MAIN" send={send} />
            ) : (
              <div className="flex items-center justify-center px-3" style={{ minWidth: 48 }}>
                <p className="text-[9px] text-zinc-700 text-center uppercase">NO OUT</p>
              </div>
            )}
          </div>

          {/* INPUTS section label */}
          <div
            className="flex items-center justify-center shrink-0 border-x border-zinc-800"
            style={{ width: 16, background: 'rgba(249,115,22,0.08)' }}
          >
            <span
              className="text-[8px] font-bold tracking-widest uppercase whitespace-nowrap"
              style={{ writingMode: 'vertical-rl', color: '#f97316' }}
            >
              IN
            </span>
          </div>

          {/* Scrollable input strips */}
          <div className="flex items-stretch overflow-x-auto">
            <div className="flex [&>*:last-child]:border-r-0">
              {inputElements.length === 0 ? (
                <div className="flex items-center justify-center px-3" style={{ minWidth: 48 }}>
                  <p className="text-[9px] text-zinc-700 text-center uppercase">NO IN</p>
                </div>
              ) : (
                inputElements.map((el) => (
                  <ChannelStrip
                    key={el.elementId}
                    elementId={el.elementId}
                    label={el.label}
                    send={send}
                    isPgm={!!pgmInput && el.mixerInput === pgmInput}
                    isPvw={!!pvwInput && el.mixerInput === pvwInput}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
