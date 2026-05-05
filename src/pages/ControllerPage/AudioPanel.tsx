import { Fragment, useRef, useCallback } from 'react'
import { useAudioStore } from '@/store/audio.store'
import { useProductionStore } from '@/store/production.store'
import { cn } from '@/lib/cn'
import type { OutboundMessage } from '@/hooks/useControllerWs'

type SendFn = (msg: OutboundMessage) => void

const FADER_H = 160
// Width of the fader container. The range input CSS height is set to this value so that
// after rotate(-90deg) it fills the container exactly — this is what centres the handle.
// Must be ≥ the widest thumb (CSS height in index.css) so the handle isn't clipped.
const FADER_W = 36

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
// Broadcast log taper with +20 dB headroom (Strom volume_N range: 0–10).
//
// UNITY_POS (0.875) is the 0 dB position — just below the top of travel.
// Below unity: log curve (0 dB at UNITY_POS, -∞ at floor).
// Above unity: also log (linear in dB), covering 0 → +20 dB in the top 12.5%.
//
// Scale marks (y = (1−pos)×160 px from top, FADER_H = 160):
//   +20 dB = 0 px, +10 dB = 10 px, 0 dB = 20 px,
//   −10 dB = 55 px, −20 dB = 90 px, −30 dB = 124 px.

// MAX_VOL = 10.0 (+20 dB) — full Strom builtin.mixer volume_N range (0–10 linear amplitude).
// The UI fader deliberately covers 0 → +20 dB; the Strom developer confirmed the 0–10 range.
const MAX_VOL    = 10.0
const UNITY_POS  = 0.875  // fader position that maps to 0 dB (1.0 amplitude)

// CSS `width` of the handle-a thumb (= visual height on screen after rotate(-90deg)).
// WebKit keeps the thumb fully inside the track, so its centre travels from
// THUMB_CSS_W/2 to FADER_H − THUMB_CSS_W/2, not the full 0…FADER_H.
// Tick mark y positions use the same inset formula so they align with the thumb centre.
const THUMB_CSS_W = 9   // matches .fader-handle-a::-webkit-slider-thumb { width: 9px }

// dB-calibrated tick marks; pixel y = (1 − pos) × FADER_H.
// Above unity: pos = UNITY_POS + log10(vol) × (1 − UNITY_POS), so:
//   +20 dB (vol=10): pos = 1.000, +10 dB (vol≈3.16): pos = 0.9375
// NOTE: `db` is intentionally NOT named `label` to avoid shadowing the
// ChannelStrip `label` prop in the map callback below.
const FADER_TICKS: Array<{ pos: number; db: string; major?: boolean; infinity?: boolean }> = [
  { pos: 1.0,       db: '+20', major: true },
  { pos: 0.9375,    db: '+10' },
  { pos: UNITY_POS, db: '0',   major: true },
  { pos: 0.656,     db: '-10' },
  { pos: 0.438,     db: '-20' },
  { pos: 0.219,     db: '-30' },
  { pos: 0,         db: '-∞',  major: true, infinity: true },
]

function faderToVolume(pos: number): number {
  if (pos <= 0) return 0
  if (pos >= 1.0) return MAX_VOL
  if (pos >= UNITY_POS) {
    // Log-in-dB taper above unity: 0 dB (1.0) → +20 dB (10.0)
    return Math.pow(10, (pos - UNITY_POS) / (1.0 - UNITY_POS))
  }
  // Log taper below unity, scaled to [0, UNITY_POS]
  const normalPos = pos / UNITY_POS
  return Math.min(Math.pow(0.01, 1 - normalPos), 0.9999)
}

function volumeToFader(vol: number): number {
  if (vol <= 0) return 0
  if (vol >= MAX_VOL) return 1.0
  if (vol >= 1.0) {
    // Log inverse above unity: vol ∈ [1, 10] → pos ∈ [UNITY_POS, 1.0]
    return UNITY_POS + Math.log10(vol) * (1.0 - UNITY_POS)
  }
  const normalPos = Math.max(0, 1 + Math.log10(vol) / 2)
  return normalPos * UNITY_POS
}

// ── Channel strip ─────────────────────────────────────────────────────────────

function ChannelStrip({ elementId, label, send, showAfv = false, mixerInput = null, isPgm = false, isPvw = false }: {
  elementId: string
  label: string
  send: SendFn
  showAfv?: boolean
  mixerInput?: string | null
  isPgm?: boolean
  isPvw?: boolean
}) {
  const level = useAudioStore((s) => s.levels[elementId] ?? 1.0)
  const muted = useAudioStore((s) => s.muted[elementId] ?? false)
  const afv   = useAudioStore((s) => s.afv[elementId] ?? false)
  const setLevel   = useAudioStore((s) => s.setLevel)
  const applyMuted = useAudioStore((s) => s.applyMuted)
  const toggleAfv  = useAudioStore((s) => s.toggleAfv)

  // Derived 3-state mode: afv wins if set, otherwise on/off from mute flag
  const mode: 'off' | 'on' | 'afv' = afv ? 'afv' : muted ? 'off' : 'on'

  const throttleRef = useRef<{ timer: ReturnType<typeof setTimeout>; last: number } | null>(null)
  const atFloorRef = useRef(false)

  // Open/closed hand cursor — apply grabbing to the whole document so it persists
  // even when the mouse leaves the input element during a fast drag.
  const handleFaderMouseDown = useCallback(() => {
    if (mode === 'off') return
    document.body.classList.add('fader-dragging')
    const onUp = () => {
      document.body.classList.remove('fader-dragging')
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mouseup', onUp)
  }, [mode])

  const handleChange = useCallback((faderPos: number) => {
    const volume = faderToVolume(faderPos)
    setLevel(elementId, volume)

    // Auto-mute when fader hits floor; unmute on any fader movement above floor
    const nowAtFloor = faderPos <= 0.02
    if (nowAtFloor && !atFloorRef.current) {
      atFloorRef.current = true
      if (!muted) {
        applyMuted(elementId, true)
        send({ type: 'AUDIO_SET', elementId, property: 'mute', value: true })
      }
    } else if (!nowAtFloor) {
      if (atFloorRef.current) atFloorRef.current = false
      if (muted) {
        applyMuted(elementId, false)
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
    if (throttleRef.current) clearTimeout(throttleRef.current.timer)
    const timer = setTimeout(() => {
      throttleRef.current = null
      send({ type: 'AUDIO_SET', elementId, property: 'volume', value: volume })
    }, 80)
    throttleRef.current = { timer, last: volume }
  }, [elementId, muted, send, setLevel, applyMuted])

  /**
   * ON button — toggles the channel routing mute.
   * If in AFV mode, disables AFV and returns to ON.
   *
   * Muting targets to_main_vol_N (routing layer), never volume_N, so the
   * fader position is always 100% user-owned and never moved by this button.
   * Strom provides a 10ms anti-click ramp on mute transitions automatically.
   */
  const handleOnClick = useCallback(() => {
    if (mode === 'on') {
      applyMuted(elementId, true)
      send({ type: 'AUDIO_SET', elementId, property: 'mute', value: true })
    } else if (mode === 'off') {
      applyMuted(elementId, false)
      send({ type: 'AUDIO_SET', elementId, property: 'mute', value: false })
    } else {
      // AFV → ON: disable routing follow and explicitly open the routing layer.
      // AFV_SET disable no longer touches to_main_vol_N (to avoid racing with
      // AUDIO_SET), so we must send AUDIO_SET mute=false to open routing ourselves.
      toggleAfv(elementId)
      send({ type: 'AUDIO_SET', elementId, property: 'mute', value: false })
      if (mixerInput !== null) {
        send({ type: 'AFV_SET', mixerInput, enabled: false })
      }
    }
  }, [mode, elementId, mixerInput, send, applyMuted, toggleAfv])

  /**
   * AFV button — enables audio-follows-video routing.
   * Disabling AFV returns to OFF (muted) so the operator must explicitly re-enable.
   *
   * Like handleOnClick, never touches volume_N — fader position is always user-owned.
   */
  const handleAfvClick = useCallback(() => {
    if (mode === 'afv') {
      // AFV → OFF: mute routing and disable AFV.
      toggleAfv(elementId)
      applyMuted(elementId, true)
      send({ type: 'AUDIO_SET', elementId, property: 'mute', value: true })
      if (mixerInput !== null) {
        send({ type: 'AFV_SET', mixerInput, enabled: false })
      }
    } else {
      // ON or OFF → AFV: just enable AFV. The AFV_SET handler on the backend
      // immediately applies the correct routing based on current PGM tally —
      // sending AUDIO_SET mute=false first would cause a brief audio burst on
      // non-PGM sources before AFV_SET closes routing again.
      toggleAfv(elementId)
      applyMuted(elementId, false)   // local store only — keeps mode='afv' if AFV later disabled via ON
      if (mixerInput !== null) {
        send({ type: 'AFV_SET', mixerInput, enabled: true })
      }
    }
  }, [mode, elementId, mixerInput, send, applyMuted, toggleAfv])

  // Strip width is fixed — tight broadcast layout
  const STRIP_W = 68

  // A strip is "active" — contributing audio to the main mix — when:
  //   • mode is ON (manual, always routes to main), OR
  //   • mode is AFV AND the source is on PGM (routing layer is open)
  // OFF strips and AFV-but-not-PGM strips are inactive (silent in the mix).
  const isActive = mode === 'on' || (mode === 'afv' && isPgm)

  return (
    <div
      className="flex flex-col shrink-0 select-none border-r border-zinc-800 relative"
      style={{ width: STRIP_W, background: '#0d0d0d' }}
    >
      {/* PGM/PVW tally ring — rendered as an overlay so it always paints above children
          (including the header's border-b, which would otherwise visually cut through it) */}
      {(isPgm || isPvw) && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            border: `1px solid ${isPgm ? '#dc2626' : '#16a34a'}`,
            zIndex: 10,
          }}
        />
      )}

      {/* Channel label header */}
      <div
        className="px-1 py-0.5 text-center border-b border-zinc-900 shrink-0"
        style={{
          background: isActive ? 'rgba(200,0,0,0.9)' : 'rgba(0,0,0,0.5)',
        }}
      >
        <span
          className="text-[9px] font-bold tracking-widest uppercase truncate block"
          style={{
            color: isActive ? '#ffffff' : '#52525b',
          }}
        >
          {label}
        </span>
      </div>

      {/* Main body — meter | fader, pulled towards each other */}
      <div className="flex gap-0 px-0.5 py-1 flex-1 justify-center">

        {/* VU meter */}
        <VuMeter elementId={elementId} />

        {/* Fader + tick marks
            DOM order = paint order (no explicit z-index on track/ticks needed):
              1. Track bar   — bottommost (DOM first)
              2. Tick marks  — above track (DOM second)
              3. Range input — topmost, z-index:2 ensures it's above tick wrappers */}
        <div className="flex items-center justify-center">
          <div className="flex flex-col items-center">
            <div className="relative" style={{ width: FADER_W, height: FADER_H }}>

              {/* 1. Track bar — rendered first so it's behind everything */}
              <div
                className="absolute pointer-events-none"
                style={{
                  width: 4,
                  height: FADER_H,
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#181818',
                  border: '1px solid #2a2a2a',
                }}
              />

              {/* 2. Tick marks — rendered second, above the track bar.
                  Each tick is two sibling elements (line + label) anchored to the same y.
                  Both use translateY(-50%) so their visual centres sit exactly at y,
                  matching the thumb centre formula used to compute y. */}
              {FADER_TICKS.map(({ pos, db, major, infinity: isInfinity }) => {
                // Inset the tick to match where the thumb centre actually sits.
                // WebKit thumb centre = THUMB_CSS_W/2 + pos_in_track * (FADER_H − THUMB_CSS_W)
                const y = Math.round(THUMB_CSS_W / 2 + (1 - pos) * (FADER_H - THUMB_CSS_W))
                return (
                  <Fragment key={db}>
                    {/* Horizontal tick line — centred on y */}
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        top: y,
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: major ? 20 : 14,
                        height: major ? 2 : 1,
                        background: major ? '#505050' : '#383838',
                      }}
                    />
                    {/* dB label — vertically centred on same y */}
                    <span
                      className="absolute pointer-events-none"
                      style={{
                        top: y,
                        left: 'calc(50% + 12px)',
                        transform: 'translateY(-50%)',
                        fontSize: isInfinity ? 10 : 6,
                        lineHeight: 1,
                        fontFamily: isInfinity ? 'sans-serif' : 'monospace',
                        color: major ? '#505050' : '#383838',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {db}
                    </span>
                  </Fragment>
                )
              })}

              {/* 3. Range input — rendered last so the handle paints above everything.
                  z-index:2 is belt-and-braces in case any parent creates a stacking context.
                  Centering: CSS height = FADER_W so after rotate(-90deg) the input fills
                  the container exactly. The handle thumb is centred via margin-top in CSS,
                  which (after rotation) controls horizontal position on screen. */}
              <input
                type="range"
                min={0}
                max={1}
                step={0.005}
                value={volumeToFader(level)}
                onChange={(e) => handleChange(parseFloat(e.target.value))}
                onMouseDown={handleFaderMouseDown}
                aria-label={`${label} fader`}
                className="fader-rotated fader-handle-a"
                style={{
                  width: FADER_H,
                  height: FADER_W,
                  left: -(FADER_H - FADER_W) / 2,
                  top:  (FADER_H - FADER_W) / 2,
                  cursor: mode === 'off' ? 'not-allowed' : 'pointer',
                  zIndex: 2,
                }}
              />

            </div>
          </div>
        </div>
      </div>

      {/* Bottom buttons — ON (active when on) + AFV (active when afv). Both inactive = OFF. */}
      <div className="border-t border-zinc-800 px-1 py-1 shrink-0 flex gap-1">
        <button
          onClick={handleOnClick}
          title={
            mode === 'on'  ? 'Channel on — click to mute'
            : mode === 'afv' ? 'Click to leave AFV and go ON'
            : 'Channel muted — click to turn on'
          }
          className={cn(
            'btn-hardware flex-1 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors',
            mode === 'on'
              ? 'border-green-700 text-green-300'
              : 'bg-zinc-900 text-zinc-500 border-zinc-700 hover:text-zinc-300',
          )}
          style={mode === 'on' ? { background: 'rgba(0,170,60,0.2)' } : {}}
        >
          ON
        </button>
        {showAfv && (
          <button
            onClick={handleAfvClick}
            title={mode === 'afv' ? 'AFV — audio follows video. Click to mute.' : 'Click to enable AFV'}
            className={cn(
              'btn-hardware flex-1 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors',
              mode === 'afv'
                ? 'border-orange-600 text-orange-300'
                : 'bg-zinc-900 text-zinc-500 border-zinc-700 hover:text-zinc-300',
            )}
            style={mode === 'afv' ? { background: 'rgba(200,100,0,0.2)' } : {}}
          >
            AFV
          </button>
        )}
      </div>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function AudioPanel({ send }: { send: SendFn }) {
  const elements = useAudioStore((s) => s.elements)
  const pgmInput = useProductionStore((s) => s.pgmInput)
  const pvwInput = useProductionStore((s) => s.pvwInput)

  const mainElement   = elements.find((e) => e.elementId === 'main')
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
              <ChannelStrip elementId="main" label="MAIN" send={send} showAfv={false} />
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
            <div className="flex">
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
                    showAfv
                    mixerInput={el.mixerInput}
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
