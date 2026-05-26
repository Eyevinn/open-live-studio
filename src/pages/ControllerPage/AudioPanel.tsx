import { Fragment, useRef, useCallback, useState, createContext, useContext } from 'react'
import { useAudioStore } from '@/store/audio.store'
import { useProductionStore } from '@/store/production.store'
import { cn } from '@/lib/cn'
import type { OutboundMessage } from '@/hooks/useControllerWs'

// ── EBU R128 Meter ────────────────────────────────────────────────────────────
// Displays momentary LUFS bar + integrated LUFS readout + latching True Peak indicator.
// Scale: −60 to 0 LUFS. Target: −23 LUFS (EBU R128 broadcast standard).

const LUFS_MIN    = -60
const LUFS_MAX    = 0
const LUFS_TARGET = -23

function lufsToRatio(lufs: number): number {
  return Math.max(0, Math.min(1, (lufs - LUFS_MIN) / (LUFS_MAX - LUFS_MIN)))
}

// EBU R128 compliance zone gradient — bottom to top: red → amber → green → amber → red.
// Zone boundaries on the −60 to 0 LUFS scale:
//   −36 LUFS = 40%   (24 / 60)  — very quiet threshold
//   −26 LUFS = 56.7% (34 / 60)  — lower green boundary
//   −20 LUFS = 66.7% (40 / 60)  — upper green boundary
//    −9 LUFS = 85%   (51 / 60)  — too loud threshold
// The bar's height% clips the gradient so only levels actually reached are shown.
const EBU_GRADIENT = [
  '#ff2020 0%',   '#ff2020 40%',    // red:   −60 to −36 LUFS (below threshold)
  '#ffcc00 40%',  '#ffcc00 56.7%',  // amber: −36 to −26 LUFS (below target)
  '#00bb44 56.7%','#00bb44 66.7%',  // green: −26 to −20 LUFS (target zone)
  '#ffcc00 66.7%','#ffcc00 85%',    // amber: −20 to  −9 LUFS (above target)
  '#ff2020 85%',  '#ff2020 100%',   // red:    −9 to   0 LUFS (too loud)
].join(', ')
const EBU_BAR_GRADIENT = `linear-gradient(to top, ${EBU_GRADIENT})`

function EbuMeter({ elementId, height, tpLatch, onResetLatch }: { elementId: string; height: number; tpLatch: boolean; onResetLatch?: () => void }) {
  const meter = useAudioStore((s) => s.meters[elementId])

  const lufs_m = meter?.lufs_m
  const lufs_i = meter?.lufs_i

  const barRatio    = lufs_m !== undefined ? lufsToRatio(lufs_m) : 0
  const targetRatio = lufsToRatio(LUFS_TARGET)

  const iStr = lufs_i !== undefined ? lufs_i.toFixed(1) : '---'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: 28, flexShrink: 0, marginTop: Math.round(THUMB_CSS_W / 2) }}>
      {/* EBU bar — same height as VU meter. True Peak latch shown as red border; click to reset. */}
      <div
        title={tpLatch ? 'True Peak exceeded −1 dBTP — click to reset' : 'EBU R128 momentary loudness'}
        onClick={tpLatch ? onResetLatch : undefined}
        style={{
          width: 10, height,
          position: 'relative',
          background: EBU_BAR_GRADIENT,
          border: tpLatch ? '1px solid #ff4040' : '1px solid #222',
          flexShrink: 0,
          cursor: tpLatch ? 'pointer' : 'default',
        }}
      >
        {/* Dark mask — shrinks from top to reveal the gradient up to current level */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          height: `${(1 - barRatio) * 100}%`,
          background: '#0a0a0a',
          transition: 'height 80ms linear',
          pointerEvents: 'none',
        }} />
        {/* Target line at −23 LUFS */}
        <div style={{
          position: 'absolute', left: 0, right: 0,
          bottom: `${targetRatio * 100}%`,
          height: 1,
          background: '#ffffff44',
          pointerEvents: 'none',
        }} />
      </div>

      {/* Integrated LUFS readout */}
      <div style={{
        fontSize: 8, fontFamily: 'monospace', whiteSpace: 'nowrap', textAlign: 'center',
        width: 28,
        color: lufs_i === undefined ? '#383838'
          : lufs_i > -20 ? '#ff4040'
          : lufs_i >= -26 ? '#00cc55'
          : lufs_i >= -36 ? '#ffaa00'
          : '#ff6666',
      }}>
        {iStr}
      </div>


    </div>
  )
}

// TP_THRESHOLD: −1 dBTP expressed as linear amplitude (10^(−1/20) ≈ 0.891).
// Strom sends true_peak in linear amplitude (0.0–1.0+), not dBTP despite the ADR.
const TP_THRESHOLD = 0.891

function EbuColumn({ elementId, isActive, tpLatch, onReset }: { elementId: string; isActive: boolean; tpLatch: boolean; onReset: () => void }) {
  const { faderH } = useFaderDims()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid #27272a', flexShrink: 0, opacity: isActive ? 1 : 0.25, transition: 'opacity 0.2s' }}>
      <div style={{ padding: '2px 4px 2px 2px', display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
        <EbuMeter elementId={elementId} height={faderH} tpLatch={tpLatch} onResetLatch={onReset} />
      </div>
    </div>
  )
}

type SendFn = (msg: OutboundMessage) => void

const FADER_H = 260
// Width of the fader container. The range input CSS height is set to this value so that
// after rotate(-90deg) it fills the container exactly — this is what centres the handle.
// Must be ≥ the widest thumb (CSS height in index.css) so the handle isn't clipped.
const FADER_W = 36

// ── Bus-type accent colours ────────────────────────────────────────────────────
// Follows broadcast console convention (Calrec / SSL language):
//   MAIN = red    — program output, "on air"
//   AUX  = amber  — independent monitor buses (IFB, recording feeds, etc.)
//   GRP  = green  — subgroup submixes that feed into main
//   IN   = blue   — individual source input channels
const C_MAIN = { hex: '#dc2626', active: 'rgba(220,38,38,0.90)',  dim: 'rgba(220,38,38,0.08)' }
const C_AUX  = { hex: '#d97706', active: 'rgba(217,119,6,0.85)',  dim: 'rgba(217,119,6,0.08)' }
const C_GRP  = { hex: '#16a34a', active: 'rgba(22,163,74,0.85)',  dim: 'rgba(22,163,74,0.08)'  }
const C_IN   = { hex: '#2563eb', active: 'rgba(37,99,235,0.85)',  dim: 'rgba(37,99,235,0.08)'  }
const C_MON  = { hex: '#a855f7', active: 'rgba(168,85,247,0.85)',  dim: 'rgba(168,85,247,0.08)'  }

// ── VU Meter — PPM-style segmented ────────────────────────────────────────────

const DB_MIN = -60
const DB_MAX = 0

function dbToRatio(db: number): number {
  return Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN)))
}

// Fixed PPM gradient: green 0→−18 dB (70%), amber −18→−6 dB (70→90%), red −6→0 dB (90→100%).
// Applied to the full bar height; the bar's height% clips it so only the segment
// above each threshold ever renders in amber/red.
const PPM_GRADIENT = 'linear-gradient(to top, #00bb44 0%, #00bb44 70%, #ffcc00 70%, #ffcc00 90%, #ff2020 90%, #ff2020 100%)'

function VuMeter({ elementId, numChannels = 1 }: { elementId: string; numChannels?: number }) {
  const { faderH } = useFaderDims()
  const meter = useAudioStore((s) => s.meters[elementId])
  const channels = meter
    ? meter.peak.map((peak, i) => ({ bar: peak, hold: meter.decay?.[i] ?? peak }))
    : Array.from({ length: numChannels }, () => ({ bar: DB_MIN, hold: DB_MIN }))

  return (
    <div style={{ width: channels.length > 1 ? 14 : 7, height: faderH, display: 'flex', gap: 2, flexShrink: 0, marginTop: Math.round(THUMB_CSS_W / 2) }}>
      {channels.map(({ bar, hold }, i) => {
        const barR  = dbToRatio(bar)
        const holdR = dbToRatio(hold)
        return (
          <div key={i} style={{ flex: 1, position: 'relative', background: PPM_GRADIENT, border: '1px solid #222' }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              height: `${(1 - barR) * 100}%`,
              background: '#0a0a0a',
              transition: 'height 80ms linear',
            }} />
            <div className="vu-segment-bar" />
            <div style={{
              position: 'absolute',
              bottom: `${holdR * 100}%`,
              left: 0, right: 0, height: 2,
              background: holdR > 0.9 ? '#ff4040' : holdR > 0.7 ? '#ffe050' : '#ffffff88',
            }} />
          </div>
        )
      })}
    </div>
  )
}

function PeakReadout({ elementId }: { elementId: string }) {
  const meter = useAudioStore((s) => s.meters[elementId])
  const peakDb = meter ? Math.max(...meter.peak) : null
  const silent = peakDb === null || !isFinite(peakDb) || peakDb < DB_MIN
  const peakStr = silent ? '−∞' : peakDb!.toFixed(1)
  const peakColor = silent ? '#383838'
    : peakDb! > -6  ? '#ff4040'
    : peakDb! > -18 ? '#ffaa00'
    : '#00cc55'
  return (
    <div style={{ fontSize: 8, fontFamily: 'monospace', whiteSpace: 'nowrap', textAlign: 'center', color: peakColor }}>
      {peakStr}
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
const THUMB_CSS_W = 23  // matches .fader-handle-a::-webkit-slider-thumb { width: 23px }
// Fader container height = meter bar height + thumb CSS width.
// The thumb is inset by THUMB_CSS_W/2 on each end, so its travel zone is exactly
// FADER_H px — matching the meter bar height — with no overshoot at either extreme.
const FADER_CONTAINER_H = FADER_H + THUMB_CSS_W   // 243 px

// Fader dimension context — lets the pop-out pane override fader height to fill the
// viewport without prop-drilling through every strip component.
const FaderDimsCtx = createContext({ faderH: FADER_H, faderContainerH: FADER_CONTAINER_H })
function useFaderDims() { return useContext(FaderDimsCtx) }

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

// Stable empty fallback for store selectors that return Record types.
// Must be defined outside components — inline `?? {}` creates a new reference
// on every render, causing Zustand to trigger an infinite rerender loop.
const EMPTY_RECORD: Record<number, boolean> = {}

// ── Channel strip ─────────────────────────────────────────────────────────────

function ChannelStrip({ elementId, label, send, showAfv = false, showPfl = false, showAfl = false, showEbu = false, mixerInput = null, isPgm = false, isPvw = false, busColor = C_MAIN, grpBuses = [] }: {
  elementId: string
  label: string
  send: SendFn
  showAfv?: boolean
  showPfl?: boolean
  showAfl?: boolean
  /** Show EBU R128 meter column — only meaningful when LoudnessData flows for this elementId (i.e. MAIN bus) */
  showEbu?: boolean
  mixerInput?: string | null
  isPgm?: boolean
  isPvw?: boolean
  busColor?: typeof C_MAIN
  /** Group buses to show assign buttons for (e.g. [1, 2]) */
  grpBuses?: number[]
}) {
  const level = useAudioStore((s) => s.levels[elementId] ?? 1.0)
  const muted = useAudioStore((s) => s.muted[elementId] ?? false)
  const afv   = useAudioStore((s) => s.afv[elementId] ?? false)
  const pfl   = useAudioStore((s) => s.pfl[elementId] ?? false)
  const afl   = useAudioStore((s) => s.afl[elementId] ?? false)
  const setLevel        = useAudioStore((s) => s.setLevel)
  const applyMuted      = useAudioStore((s) => s.applyMuted)
  const toggleAfv       = useAudioStore((s) => s.toggleAfv)
  const applyPfl        = useAudioStore((s) => s.applyPfl)
  const applyAfl        = useAudioStore((s) => s.applyAfl)
  const grpSendEnabled  = useAudioStore((s) => s.grpSendEnabled[elementId] ?? EMPTY_RECORD)
  const setGrpEnabled   = useAudioStore((s) => s.setGrpSendEnabled)
  const truePeak        = useAudioStore((s) => showEbu ? s.meters[elementId]?.true_peak : undefined)
  const tpLatch         = showEbu && (truePeak?.length ?? 0) > 0 && truePeak!.some((tp) => tp > TP_THRESHOLD)
  const handleLoudnessReset = useCallback(() => { send({ type: 'LOUDNESS_RESET' }) }, [send])

  // Derived 3-state mode: afv wins if set, otherwise on/off from mute flag
  const mode: 'off' | 'on' | 'afv' = afv ? 'afv' : muted ? 'off' : 'on'

  const handleFaderMouseDown = useCallback(() => {
    if (mode === 'off') return
    document.body.classList.add('fader-dragging')
    const onUp = () => {
      document.body.classList.remove('fader-dragging')
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mouseup', onUp)
  }, [mode])

  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = useCallback((faderPos: number) => {
    const pos = faderPos >= 0.995 ? 1 : faderPos <= 0.005 ? 0 : faderPos
    const volume = faderToVolume(pos)
    setLevel(elementId, volume)
    if (throttleRef.current !== null) clearTimeout(throttleRef.current)
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null
      send({ type: 'AUDIO_SET', elementId, property: 'volume', value: volume })
    }, 80)
  }, [elementId, send, setLevel])

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

  const handlePflClick = useCallback(() => {
    const next = !pfl
    applyPfl(elementId, next)
    send({ type: 'PFL_SET', elementId, enabled: next, volume: level })
    // Mutually exclusive per strip — enabling PFL cancels AFL on same channel
    if (next && afl) {
      applyAfl(elementId, false)
      send({ type: 'AFL_SET', elementId, enabled: false })
    }
  }, [pfl, afl, elementId, level, send, applyPfl, applyAfl])

  const handleAflClick = useCallback(() => {
    const next = !afl
    applyAfl(elementId, next)
    send({ type: 'AFL_SET', elementId, enabled: next })
    // Mutually exclusive per strip — enabling AFL cancels PFL on same channel
    if (next && pfl) {
      applyPfl(elementId, false)
      send({ type: 'PFL_SET', elementId, enabled: false })
    }
  }, [afl, pfl, elementId, level, send, applyAfl, applyPfl])

  const { faderContainerH } = useFaderDims()

  // Left button column is only rendered when there are groups or PFL/AFL buttons.
  // Without it the strip reverts to the old compact width.
  const hasLeftButtons = grpBuses.length > 0 || showPfl || showAfl
  const STRIP_W = showEbu
    ? (hasLeftButtons ? 145 : 124)
    : (hasLeftButtons ? 111 : 92)

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
      {/* Channel label header */}
      <div
        className="px-1 py-0.5 text-center border-b border-zinc-900 shrink-0"
        style={{
          background: isActive ? busColor.active : 'rgba(0,0,0,0.5)',
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

      {/* Main body */}
      <div className="flex flex-1 pb-2">

        {/* Left side buttons — G1/G2 + PFL/AFL stacked vertically with padding and gaps */}
        {(grpBuses.length > 0 || showPfl || showAfl) && (
          <div className="flex flex-col shrink-0 justify-center" style={{ width: 28, padding: '0 0 0 7px', gap: 8 }}>
            {grpBuses.map((bus) => {
              const assigned = grpSendEnabled[bus] ?? false
              return (
                <button
                  key={bus}
                  onClick={() => {
                    const next = !assigned
                    setGrpEnabled(elementId, bus, next)
                    send({ type: 'GRP_SEND_SET', elementId, grpBus: bus, level: 1, enabled: next })
                  }}
                  title={assigned ? `Remove from Group ${bus}` : `Add to Group ${bus}`}
                  className="border-0 cursor-pointer transition-colors active:opacity-75 flex items-center justify-center shrink-0"
                  style={{ background: assigned ? C_GRP.active : '#27272a', borderRadius: 2, width: '100%', height: 22 }}
                >
                  <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.05em', color: assigned ? '#fff' : '#52525b', textTransform: 'uppercase' }}>G{bus}</span>
                </button>
              )
            })}
            {showPfl && (
              <button
                onClick={handlePflClick}
                title={pfl ? 'PFL active — click to cancel' : 'PFL — pre-fader listen on MON'}
                className="border-0 cursor-pointer transition-colors active:opacity-75 flex items-center justify-center shrink-0"
                style={{ background: pfl ? '#ca8a04' : '#27272a', borderRadius: 2, width: '100%', height: 22 }}
              >
                <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.05em', color: pfl ? '#fff' : '#52525b', textTransform: 'uppercase' }}>PFL</span>
              </button>
            )}
            {showAfl && (
              <button
                onClick={handleAflClick}
                title={afl ? 'AFL active — click to cancel' : 'AFL — post-fader listen on MON'}
                className="border-0 cursor-pointer transition-colors active:opacity-75 flex items-center justify-center shrink-0"
                style={{ background: afl ? '#ca8a04' : '#27272a', borderRadius: 2, width: '100%', height: 22 }}
              >
                <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.05em', color: afl ? '#fff' : '#52525b', textTransform: 'uppercase' }}>AFL</span>
              </button>
            )}
          </div>
        )}

        {/* EBU sub-column — separated by border when visible */}
        {showEbu && <EbuColumn elementId={elementId} isActive={isActive} tpLatch={tpLatch} onReset={handleLoudnessReset} />}

        {/* VU + fader sub-column */}
        <div style={{ display: 'flex', alignItems: 'flex-start', padding: '2px 0 2px 0', flex: 1 }}>

          {/* VU meter + peak readout — wider container centers the text under the bars */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28, gap: 2, opacity: isActive ? 1 : 0.25, transition: 'opacity 0.2s' }}>
            <VuMeter elementId={elementId} />
            <PeakReadout elementId={elementId} />
          </div>

          {/* Fader + tick marks */}
          <div className="relative shrink-0" style={{ width: FADER_W, height: faderContainerH }}>

            <div
              className="absolute pointer-events-none"
              style={{
                width: 4,
                height: faderContainerH - THUMB_CSS_W,
                top: Math.round(THUMB_CSS_W / 2),
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#181818',
                border: '1px solid #2a2a2a',
              }}
            />

            {FADER_TICKS.map(({ pos, db, major, infinity: isInfinity }) => {
              const y = Math.round(THUMB_CSS_W / 2 + (1 - pos) * (faderContainerH - THUMB_CSS_W))
              return (
                <Fragment key={db}>
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      top: y, left: '50%', transform: 'translate(-50%, -50%)',
                      width: major ? 20 : 14, height: major ? 2 : 1,
                      background: major ? '#505050' : '#383838',
                    }}
                  />
                  <span
                    className="absolute pointer-events-none"
                    style={{
                      top: y, left: 'calc(50% + 15px)', transform: 'translateY(-50%)',
                      fontSize: isInfinity ? 9 : 6, lineHeight: 1,
                      fontFamily: 'monospace',
                      color: major ? '#505050' : '#383838', whiteSpace: 'nowrap',
                    }}
                  >
                    {db}
                  </span>
                </Fragment>
              )
            })}

            <input
              type="range"
              min={0} max={1} step={0.005}
              value={volumeToFader(level)}
              onChange={(e) => handleChange(parseFloat(e.target.value))}
              onMouseDown={handleFaderMouseDown}
              aria-label={`${label} fader`}
              className="fader-rotated fader-handle-a"
              style={{
                width: faderContainerH, height: FADER_W,
                left: -(faderContainerH - FADER_W) / 2,
                top:  (faderContainerH - FADER_W) / 2,
                cursor: mode === 'off' ? 'not-allowed' : 'pointer',
                zIndex: 2,
              }}
            />
          </div>
        </div>
      </div>

      {/* Bottom buttons */}
      <div className="border-t border-zinc-800 shrink-0 flex flex-col">
        {/* ON / AFV row */}
        <div className="flex gap-px">
          <button
            onClick={handleOnClick}
            title={
              mode === 'on'  ? 'Channel on — click to mute'
              : mode === 'afv' ? 'Click to leave AFV and go ON'
              : 'Channel muted — click to turn on'
            }
            className={cn(
              'flex-1 py-1 text-[9px] font-bold uppercase tracking-widest border-0 transition-colors cursor-pointer active:opacity-75',
              mode === 'on'
                ? 'text-white'
                : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300',
            )}
            style={mode === 'on' ? { background: busColor.active } : {}}
          >
            ON
          </button>
          {showAfv && (
            <button
              onClick={handleAfvClick}
              title={mode === 'afv' ? 'AFV — audio follows video. Click to mute.' : 'Click to enable AFV'}
              className={cn(
                'flex-1 py-1 text-[9px] font-bold uppercase tracking-widest border-0 transition-colors cursor-pointer active:opacity-75',
                mode === 'afv' ? 'text-white' : 'text-zinc-500',
              )}
              style={mode === 'afv' ? { background: '#c86400' } : { background: '#18181b' }}
            >
              AFV
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── AUX Channel strip ─────────────────────────────────────────────────────────
// Shown in AUX tabs. Fader = send level for this channel to the AUX bus.
// ON/OFF routes or silences the send without losing the fader position.

function AuxChannelStrip({ elementId, label, auxBus, send }: {
  elementId: string
  label: string
  auxBus: number
  send: SendFn
}) {
  const { faderContainerH } = useFaderDims()
  const level          = useAudioStore((s) => s.auxSend[elementId]?.[auxBus] ?? 0)
  const enabled        = useAudioStore((s) => s.auxSendEnabled[elementId]?.[auxBus] ?? false)
  const pre            = useAudioStore((s) => s.auxSendPre[elementId]?.[auxBus] ?? true)
  const setAuxSend     = useAudioStore((s) => s.setAuxSend)
  const setAuxEnabled  = useAudioStore((s) => s.setAuxSendEnabled)

  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = useCallback((faderPos: number) => {
    const newLevel = faderToVolume(faderPos)
    setAuxSend(elementId, auxBus, newLevel)
    if (throttleRef.current !== null) clearTimeout(throttleRef.current)
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null
      send({ type: 'AUX_SEND_SET', elementId, auxBus, level: newLevel, enabled, pre })
    }, 80)
  }, [elementId, auxBus, enabled, pre, send, setAuxSend])

  const handleOnClick = useCallback(() => {
    const next = !enabled
    setAuxEnabled(elementId, auxBus, next)
    send({ type: 'AUX_SEND_SET', elementId, auxBus, level, enabled: next, pre })
  }, [enabled, pre, level, elementId, auxBus, send, setAuxEnabled])

  const STRIP_W = 92

  return (
    <div
      className="flex flex-col shrink-0 select-none border-r border-zinc-800"
      style={{ width: STRIP_W, background: '#0d0d0d', opacity: enabled ? 1 : 0.55 }}
    >
      {/* Channel label header — blue tint when send is active */}
      <div
        className="px-1 py-0.5 text-center border-b border-zinc-900 shrink-0"
        style={{ background: enabled ? C_IN.active : 'rgba(0,0,0,0.5)' }}
      >
        <span
          className="text-[9px] font-bold tracking-widest uppercase truncate block"
          style={{ color: enabled ? '#ffffff' : '#52525b' }}
        >
          {label}
        </span>
      </div>

      {/* Main body — meter | fader */}
      <div className="flex flex-1 pb-2">

        {/* VU + fader sub-column */}
        <div style={{ display: 'flex', alignItems: 'flex-start', padding: '2px 0 2px 8px', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28, gap: 2 }}>
            <VuMeter elementId={elementId} />
            <PeakReadout elementId={elementId} />
          </div>
          <div className="relative shrink-0" style={{ width: FADER_W, height: faderContainerH }}>
            <div className="absolute pointer-events-none" style={{ width: 4, height: faderContainerH - THUMB_CSS_W, top: Math.round(THUMB_CSS_W / 2), left: '50%', transform: 'translateX(-50%)', background: '#181818', border: '1px solid #2a2a2a' }} />
            {FADER_TICKS.map(({ pos, db, major, infinity: isInfinity }) => {
              const y = Math.round(THUMB_CSS_W / 2 + (1 - pos) * (faderContainerH - THUMB_CSS_W))
              return (
                <Fragment key={db}>
                  <div className="absolute pointer-events-none" style={{ top: y, left: '50%', transform: 'translate(-50%, -50%)', width: major ? 20 : 14, height: major ? 2 : 1, background: major ? '#505050' : '#383838' }} />
                  <span className="absolute pointer-events-none" style={{ top: y, left: 'calc(50% + 15px)', transform: 'translateY(-50%)', fontSize: isInfinity ? 9 : 6, lineHeight: 1, fontFamily: 'monospace', color: major ? '#505050' : '#383838', whiteSpace: 'nowrap' }}>{db}</span>
                </Fragment>
              )
            })}
            <input
              type="range" min={0} max={1} step={0.005}
              value={volumeToFader(level)}
              onChange={(e) => handleChange(parseFloat(e.target.value))}
              aria-label={`${label} AUX ${auxBus} send`}
              className="fader-rotated fader-handle-a"
              style={{ width: faderContainerH, height: FADER_W, left: -(faderContainerH - FADER_W) / 2, top: (faderContainerH - FADER_W) / 2, cursor: 'pointer', zIndex: 2 }}
            />
          </div>
        </div>
      </div>

      {/* Bottom — ON button */}
      <div className="border-t border-zinc-800 shrink-0 flex overflow-hidden">
        <button
          onClick={handleOnClick}
          title={enabled ? 'Send active — click to remove from mix' : 'Send silent — click to route to mix'}
          className={cn(
            'flex-1 py-1 text-[9px] font-bold uppercase tracking-widest border-0 transition-colors cursor-pointer active:opacity-75',
            enabled
              ? 'text-white'
              : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300',
          )}
          style={enabled ? { background: C_IN.active } : {}}
        >
          ON
        </button>
      </div>
    </div>
  )
}

// ── AUX Master strip ──────────────────────────────────────────────────────────
// Always visible in the output section alongside MAIN.
// Fader = overall AUX bus output level; ON/OFF = mute the entire bus.
// Meter element ID "aux1"/"aux2" matches what the meter relay broadcasts.
// onSelect: optional — when provided, clicking the header label selects this bus in the AUX tab.

function AuxMasterStrip({ auxBus, label, send, onSelect }: {
  auxBus: number
  label: string
  send: SendFn
  onSelect?: () => void
}) {
  const { faderContainerH } = useFaderDims()
  const level           = useAudioStore((s) => s.auxMasterLevel[auxBus] ?? 1.0)
  const muted           = useAudioStore((s) => s.auxMasterMuted[auxBus] ?? false)
  const setMasterLevel  = useAudioStore((s) => s.setAuxMasterLevel)
  const setMasterMuted  = useAudioStore((s) => s.setAuxMasterMuted)
  const meterId         = `aux${auxBus}`

  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleFaderMouseDown = useCallback(() => {
    document.body.classList.add('fader-dragging')
    const onUp = () => {
      document.body.classList.remove('fader-dragging')
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mouseup', onUp)
  }, [])

  const handleChange = useCallback((faderPos: number) => {
    const pos = faderPos >= 0.995 ? 1 : faderPos <= 0.005 ? 0 : faderPos
    const volume = faderToVolume(pos)
    setMasterLevel(auxBus, volume)
    if (throttleRef.current !== null) clearTimeout(throttleRef.current)
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null
      send({ type: 'AUX_MASTER_SET', auxBus, volume, muted })
    }, 80)
  }, [auxBus, muted, send, setMasterLevel])

  const handleOnClick = useCallback(() => {
    const next = !muted
    setMasterMuted(auxBus, next)
    send({ type: 'AUX_MASTER_SET', auxBus, volume: level, muted: next })
  }, [muted, level, auxBus, send, setMasterMuted])

  const isActive = !muted
  const STRIP_W = 92

  return (
    <div
      className="flex flex-col shrink-0 select-none border-r border-zinc-800 relative"
      style={{ width: STRIP_W, background: '#0d0d0d' }}
    >
      {/* Channel label header */}
      <div
        className={cn('px-1 py-0.5 text-center border-b border-zinc-900 shrink-0', onSelect && 'cursor-pointer hover:opacity-80')}
        style={{ background: isActive ? C_AUX.active : 'rgba(0,0,0,0.5)', outline: onSelect ? `1px solid ${C_AUX.hex}66` : undefined }}
        onClick={onSelect}
        title={onSelect ? `Open ${label} sends` : undefined}
      >
        <span
          className="text-[9px] font-bold tracking-widest uppercase truncate block"
          style={{ color: isActive ? '#ffffff' : '#52525b' }}
        >
          {label}
        </span>
      </div>

      {/* Main body — meter | fader */}
      <div style={{ display: 'flex', alignItems: 'flex-start', padding: '2px 0 2px 8px', flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28, gap: 2, opacity: isActive ? 1 : 0.25, transition: 'opacity 0.2s' }}>
          <VuMeter elementId={meterId} />
          <PeakReadout elementId={meterId} />
        </div>
        <div className="relative shrink-0" style={{ width: FADER_W, height: faderContainerH }}>
          <div className="absolute pointer-events-none" style={{ width: 4, height: faderContainerH - THUMB_CSS_W, top: Math.round(THUMB_CSS_W / 2), left: '50%', transform: 'translateX(-50%)', background: '#181818', border: '1px solid #2a2a2a' }} />
          {FADER_TICKS.map(({ pos, db, major, infinity: isInfinity }) => {
            const y = Math.round(THUMB_CSS_W / 2 + (1 - pos) * (faderContainerH - THUMB_CSS_W))
            return (
              <Fragment key={db}>
                <div className="absolute pointer-events-none" style={{ top: y, left: '50%', transform: 'translate(-50%, -50%)', width: major ? 20 : 14, height: major ? 2 : 1, background: major ? '#505050' : '#383838' }} />
                <span className="absolute pointer-events-none" style={{ top: y, left: 'calc(50% + 15px)', transform: 'translateY(-50%)', fontSize: isInfinity ? 9 : 6, lineHeight: 1, fontFamily: 'monospace', color: major ? '#505050' : '#383838', whiteSpace: 'nowrap' }}>{db}</span>
              </Fragment>
            )
          })}
          <input
            type="range" min={0} max={1} step={0.005}
            value={volumeToFader(level)}
            onChange={(e) => handleChange(parseFloat(e.target.value))}
            onMouseDown={handleFaderMouseDown}
            aria-label={`${label} master fader`}
            className="fader-rotated fader-handle-a"
            style={{ width: faderContainerH, height: FADER_W, left: -(faderContainerH - FADER_W) / 2, top: (faderContainerH - FADER_W) / 2, cursor: muted ? 'not-allowed' : 'pointer', zIndex: 2 }}
          />
        </div>
      </div>

      {/* Bottom */}
      <div className="border-t border-zinc-800 shrink-0 flex overflow-hidden">
        <button
          onClick={handleOnClick}
          title={muted ? 'AUX bus muted — click to unmute' : 'AUX bus active — click to mute'}
          className={cn(
            'flex-1 py-1 text-[9px] font-bold uppercase tracking-widest border-0 transition-colors cursor-pointer active:opacity-75',
            isActive
              ? 'text-white'
              : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300',
          )}
          style={isActive ? { background: C_AUX.active } : {}}
        >
          ON
        </button>
      </div>
    </div>
  )
}

// ── GRP Master strip ──────────────────────────────────────────────────────────
// Fader = overall GRP bus output level; ON/OFF = mute the entire bus.
// Meter element ID "grp1"/"grp2" matches what the meter relay broadcasts.
// onSelect: optional — when provided, clicking the header label selects this bus in the GROUPS tab.

function GrpMasterStrip({ grpBus, label, send, onSelect }: {
  grpBus: number
  label: string
  send: SendFn
  onSelect?: () => void
}) {
  const { faderContainerH } = useFaderDims()
  const level           = useAudioStore((s) => s.grpMasterLevel[grpBus] ?? 1.0)
  const muted           = useAudioStore((s) => s.grpMasterMuted[grpBus] ?? false)
  const setMasterLevel  = useAudioStore((s) => s.setGrpMasterLevel)
  const setMasterMuted  = useAudioStore((s) => s.setGrpMasterMuted)
  const meterId         = `grp${grpBus}`

  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleFaderMouseDown = useCallback(() => {
    document.body.classList.add('fader-dragging')
    const onUp = () => {
      document.body.classList.remove('fader-dragging')
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mouseup', onUp)
  }, [])

  const handleChange = useCallback((faderPos: number) => {
    const pos = faderPos >= 0.995 ? 1 : faderPos <= 0.005 ? 0 : faderPos
    const volume = faderToVolume(pos)
    setMasterLevel(grpBus, volume)
    if (throttleRef.current !== null) clearTimeout(throttleRef.current)
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null
      send({ type: 'GRP_MASTER_SET', grpBus, volume, muted })
    }, 80)
  }, [grpBus, muted, send, setMasterLevel])

  const handleOnClick = useCallback(() => {
    const next = !muted
    setMasterMuted(grpBus, next)
    send({ type: 'GRP_MASTER_SET', grpBus, volume: level, muted: next })
  }, [muted, level, grpBus, send, setMasterMuted])

  const isActive = !muted
  const STRIP_W = 92

  return (
    <div
      className="flex flex-col shrink-0 select-none border-r border-zinc-800 relative"
      style={{ width: STRIP_W, background: '#0d0d0d' }}
    >
      {/* Channel label header — violet when active */}
      <div
        className={cn('px-1 py-0.5 text-center border-b border-zinc-900 shrink-0', onSelect && 'cursor-pointer hover:opacity-80')}
        style={{
          background: isActive ? C_GRP.active : 'rgba(0,0,0,0.5)',
          outline: onSelect ? `1px solid ${C_GRP.hex}4d` : undefined,
        }}
        onClick={onSelect}
        title={onSelect ? `Open ${label} sends` : undefined}
      >
        <span
          className="text-[9px] font-bold tracking-widest uppercase truncate block"
          style={{ color: isActive ? '#ffffff' : '#52525b' }}
        >
          {label}
        </span>
      </div>

      {/* Main body — meter | fader */}
      <div style={{ display: 'flex', alignItems: 'flex-start', padding: '2px 0 2px 8px', flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28, gap: 2, opacity: isActive ? 1 : 0.25, transition: 'opacity 0.2s' }}>
          <VuMeter elementId={meterId} />
          <PeakReadout elementId={meterId} />
        </div>
        <div className="relative shrink-0" style={{ width: FADER_W, height: faderContainerH }}>
          <div className="absolute pointer-events-none" style={{ width: 4, height: faderContainerH - THUMB_CSS_W, top: Math.round(THUMB_CSS_W / 2), left: '50%', transform: 'translateX(-50%)', background: '#181818', border: '1px solid #2a2a2a' }} />
          {FADER_TICKS.map(({ pos, db, major, infinity: isInfinity }) => {
            const y = Math.round(THUMB_CSS_W / 2 + (1 - pos) * (faderContainerH - THUMB_CSS_W))
            return (
              <Fragment key={db}>
                <div className="absolute pointer-events-none" style={{ top: y, left: '50%', transform: 'translate(-50%, -50%)', width: major ? 20 : 14, height: major ? 2 : 1, background: major ? '#505050' : '#383838' }} />
                <span className="absolute pointer-events-none" style={{ top: y, left: 'calc(50% + 15px)', transform: 'translateY(-50%)', fontSize: isInfinity ? 9 : 6, lineHeight: 1, fontFamily: 'monospace', color: major ? '#505050' : '#383838', whiteSpace: 'nowrap' }}>{db}</span>
              </Fragment>
            )
          })}
          <input
            type="range" min={0} max={1} step={0.005}
            value={volumeToFader(level)}
            onChange={(e) => handleChange(parseFloat(e.target.value))}
            onMouseDown={handleFaderMouseDown}
            aria-label={`${label} master fader`}
            className="fader-rotated fader-handle-a"
            style={{ width: faderContainerH, height: FADER_W, left: -(faderContainerH - FADER_W) / 2, top: (faderContainerH - FADER_W) / 2, cursor: muted ? 'not-allowed' : 'pointer', zIndex: 2 }}
          />
        </div>
      </div>

      {/* Bottom */}
      <div className="border-t border-zinc-800 shrink-0 flex overflow-hidden">
        <button
          onClick={handleOnClick}
          title={muted ? 'GRP bus muted — click to unmute' : 'GRP bus active — click to mute'}
          className={cn(
            'flex-1 py-1 text-[9px] font-bold uppercase tracking-widest border-0 transition-colors cursor-pointer active:opacity-75',
            isActive
              ? 'text-white'
              : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300',
          )}
          style={isActive ? { background: C_GRP.active } : {}}
        >
          ON
        </button>
      </div>
    </div>
  )
}

// ── Monitor Master strip ──────────────────────────────────────────────────────
// Controls the operator's local listening level on monitor_out.
// Zero effect on the programme mix — purely a local monitoring control.

function MonitorMasterStrip({ send }: { send: SendFn }) {
  const { faderContainerH } = useFaderDims()
  const level      = useAudioStore((s) => s.monitorLevel)
  const muted      = useAudioStore((s) => s.monitorMuted)
  const setLevel   = useAudioStore((s) => s.setMonitorLevel)
  const setMuted   = useAudioStore((s) => s.setMonitorMuted)

  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleFaderMouseDown = useCallback(() => {
    document.body.classList.add('fader-dragging')
    const onUp = () => {
      document.body.classList.remove('fader-dragging')
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mouseup', onUp)
  }, [])

  const handleChange = useCallback((faderPos: number) => {
    const pos = faderPos >= 0.995 ? 1 : faderPos <= 0.005 ? 0 : faderPos
    const volume = faderToVolume(pos)
    setLevel(volume)
    if (throttleRef.current !== null) clearTimeout(throttleRef.current)
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null
      send({ type: 'MONITOR_SET', volume, muted })
    }, 80)
  }, [muted, send, setLevel])

  const handleOnClick = useCallback(() => {
    const next = !muted
    setMuted(next)
    send({ type: 'MONITOR_SET', volume: level, muted: next })
  }, [muted, level, send, setMuted])

  const isActive = !muted
  const STRIP_W = 92

  return (
    <div
      className="flex flex-col shrink-0 select-none border-r border-zinc-800 relative"
      style={{ width: STRIP_W, background: '#0d0d0d' }}
    >
      <div
        className="px-1 py-0.5 text-center border-b border-zinc-900 shrink-0"
        style={{ background: isActive ? C_MON.active : 'rgba(0,0,0,0.5)' }}
      >
        <span
          className="text-[9px] font-bold tracking-widest uppercase truncate block"
          style={{ color: isActive ? '#ffffff' : '#52525b' }}
        >
          MON
        </span>
      </div>

      {/* VU meter — awaiting monitor_out metering support from Strom (meter:monitor element).
          Until then the bars will be empty but the strip layout is ready. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', padding: '2px 0 2px 8px', flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 28, gap: 2, opacity: isActive ? 1 : 0.25, transition: 'opacity 0.2s' }}>
          <VuMeter elementId="monitor" numChannels={2} />
          <PeakReadout elementId="monitor" />
        </div>
        <div className="relative shrink-0" style={{ width: FADER_W, height: faderContainerH }}>
          <div className="absolute pointer-events-none" style={{ width: 4, height: faderContainerH - THUMB_CSS_W, top: Math.round(THUMB_CSS_W / 2), left: '50%', transform: 'translateX(-50%)', background: '#181818', border: '1px solid #2a2a2a' }} />
          {FADER_TICKS.map(({ pos, db, major, infinity: isInfinity }) => {
            const y = Math.round(THUMB_CSS_W / 2 + (1 - pos) * (faderContainerH - THUMB_CSS_W))
            return (
              <Fragment key={db}>
                <div className="absolute pointer-events-none" style={{ top: y, left: '50%', transform: 'translate(-50%, -50%)', width: major ? 20 : 14, height: major ? 2 : 1, background: major ? '#505050' : '#383838' }} />
                <span className="absolute pointer-events-none" style={{ top: y, left: 'calc(50% + 15px)', transform: 'translateY(-50%)', fontSize: isInfinity ? 9 : 6, lineHeight: 1, fontFamily: 'monospace', color: major ? '#505050' : '#383838', whiteSpace: 'nowrap' }}>{db}</span>
              </Fragment>
            )
          })}
          <input
            type="range" min={0} max={1} step={0.005}
            value={volumeToFader(level)}
            onChange={(e) => handleChange(parseFloat(e.target.value))}
            onMouseDown={handleFaderMouseDown}
            aria-label="Monitor master fader"
            className="fader-rotated fader-handle-a"
            style={{ width: faderContainerH, height: FADER_W, left: -(faderContainerH - FADER_W) / 2, top: (faderContainerH - FADER_W) / 2, cursor: muted ? 'not-allowed' : 'pointer', zIndex: 2 }}
          />
        </div>
      </div>

      <div className="border-t border-zinc-800 shrink-0 flex overflow-hidden">
        <button
          onClick={handleOnClick}
          title={muted ? 'Monitor muted — click to unmute' : 'Monitor active — click to mute'}
          className={cn(
            'flex-1 py-1 text-[9px] font-bold uppercase tracking-widest border-0 transition-colors cursor-pointer active:opacity-75',
            isActive ? 'text-white' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300',
          )}
          style={isActive ? { background: C_MON.active } : {}}
        >
          ON
        </button>
      </div>
    </div>
  )
}

// ── Section bar ───────────────────────────────────────────────────────────────
// Vertical label bar used in the MAIN tab for collapsible sections.
// Click to collapse/expand. Arrow indicator shows state.

function SectionBar({ label, collapsed, onToggle, color = '#f97316' }: {
  label: string
  collapsed: boolean
  onToggle: () => void
  color?: string
}) {
  return (
    <div
      className="flex flex-col items-center justify-start shrink-0 border-r border-zinc-800 cursor-pointer select-none"
      style={{ width: 16, background: collapsed ? 'transparent' : `${color}14`, minHeight: 40 }}
      onClick={onToggle}
      title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
    >
      <span style={{ fontSize: 8, color, marginTop: 4, lineHeight: 1 }}>{collapsed ? '▶' : '▼'}</span>
      <span
        className="text-[8px] font-bold tracking-widest uppercase whitespace-nowrap"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', color, marginTop: 3 }}
      >
        {label}
      </span>
    </div>
  )
}

// ── NoContent helper ──────────────────────────────────────────────────────────

function NoContent({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center px-3" style={{ minWidth: 48 }}>
      <p className="text-[9px] text-zinc-700 text-center uppercase">{label}</p>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────
// Three top-level tabs: MAIN, AUX, GROUPS.
//
// MAIN  → four collapsible sections side by side: OUT | AUX | GRP | IN
// AUX   → drill-down: list of AUX master strips, click to see per-channel sends
// GROUPS → same drill-down pattern for GRP buses

type AudioTab = string  // 'main' | 'aux-1' | 'aux-2' | …

export function AudioPanel({ send, numAuxBuses = 2, numGroups = 2, showEbuMain = false, faderHeight }: { send: SendFn; numAuxBuses?: number; numGroups?: number; showEbuMain?: boolean; faderHeight?: number }) {
  const fH = faderHeight ?? FADER_H
  const fCH = fH + THUMB_CSS_W
  const elements = useAudioStore((s) => s.elements)
  const pgmInput = useProductionStore((s) => s.pgmInput)
  const pvwInput = useProductionStore((s) => s.pvwInput)

  // Derive bus index arrays from counts
  const auxBuses = Array.from({ length: numAuxBuses }, (_, i) => i + 1)
  const grpBuses = Array.from({ length: numGroups }, (_, i) => i + 1)

  const [activeTab, setActiveTab] = useState<AudioTab>('main')
  // MAIN tab — per-section collapsed state; all expanded by default
  const [collapsed, setCollapsed] = useState({ out: false, groups: false, in: false })
  const toggleSection = (k: keyof typeof collapsed) => setCollapsed((c) => ({ ...c, [k]: !c[k] }))
  // AUX tabs — shared collapsed state for OUT/IN sections
  const [auxCollapsed, setAuxCollapsed] = useState({ out: false, in: false })
  const toggleAuxSection = (k: keyof typeof auxCollapsed) => setAuxCollapsed((c) => ({ ...c, [k]: !c[k] }))

  const mainElement   = elements.find((e) => e.elementId === 'main')
  const inputElements = elements.filter((e) => e.elementId !== 'main' && e.mixerInput !== null)
  const hasContent = elements.length > 0

  // One tab per AUX bus — clicking goes directly to that bus's send view, no drill-down
  const TABS: Array<{ id: AudioTab; label: string; color: string }> = [
    { id: 'main', label: 'MAIN', color: C_MAIN.hex },
    ...auxBuses.map((bus) => ({ id: `aux-${bus}`, label: `AUX ${bus}`, color: C_AUX.hex })),
    // GRP tab removed — groups are managed via G1/G2 buttons on each channel strip in MAIN
  ]

  // Extract selected AUX bus number from the active tab id, e.g. 'aux-2' → 2
  const activeAuxBus = activeTab.startsWith('aux-') ? parseInt(activeTab.slice(4), 10) : null

  return (
    <FaderDimsCtx.Provider value={{ faderH: fH, faderContainerH: fCH }}>
    <div
      className="border border-zinc-800 overflow-hidden flex items-stretch"
      style={{ background: '#0d0d0d', minHeight: 300 }}
    >
      {/* Tab selector — vertical, left edge */}
      <div className="flex flex-col shrink-0 border-r border-zinc-800" style={{ width: 20 }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            className="flex-1 flex items-center justify-center transition-colors border-b border-zinc-800 last:border-b-0"
            style={{
              background: activeTab === tab.id ? `${tab.color}1f` : 'transparent',
              cursor: 'pointer',
            }}
          >
            <span
              className="text-[7px] font-bold tracking-widest uppercase whitespace-nowrap"
              style={{
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
                color: activeTab === tab.id ? tab.color : '#52525b',
              }}
            >
              {tab.label}
            </span>
          </button>
        ))}
      </div>

      {!hasContent ? (
        <div className="flex items-center justify-center min-h-[160px] px-4 flex-1">
          <p className="text-[9px] text-zinc-700 text-center uppercase tracking-widest">NO CHANNELS</p>
        </div>
      ) : (
        <>
          {/* ── MAIN tab ─────────────────────────────────────────────────── */}
          {activeTab === 'main' && (
            <>
              {/* OUT section */}
              <SectionBar label="OUT" collapsed={collapsed.out} onToggle={() => toggleSection('out')} color={C_MAIN.hex} />
              {!collapsed.out && (
                <div className="flex items-stretch shrink-0">
                  {mainElement ? (
                    <ChannelStrip elementId="main" label="MAIN" send={send} showAfv={false} showEbu={showEbuMain} busColor={C_MAIN} />
                  ) : (
                    <NoContent label="NO OUT" />
                  )}
                  <MonitorMasterStrip send={send} />
                </div>
              )}

              {/* GROUPS section */}
              {grpBuses.length > 0 && (
                <>
                  <SectionBar label="GRP" collapsed={collapsed.groups} onToggle={() => toggleSection('groups')} color={C_GRP.hex} />
                  {!collapsed.groups && (
                    <div className="flex items-stretch shrink-0">
                      {grpBuses.map((bus) => (
                        <GrpMasterStrip key={bus} grpBus={bus} label={`GRP ${bus}`} send={send} />
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* IN section */}
              <SectionBar label="IN" collapsed={collapsed.in} onToggle={() => toggleSection('in')} color={C_IN.hex} />
              {!collapsed.in && (
                <div className="flex items-stretch overflow-x-auto scrollbar-hide">
                  <div className="flex">
                    {inputElements.length === 0 ? (
                      <NoContent label="NO IN" />
                    ) : (
                      inputElements.map((el) => (
                        <ChannelStrip
                          key={el.elementId}
                          elementId={el.elementId}
                          label={el.label}
                          send={send}
                          showAfv
                          showPfl
                          showAfl
                          mixerInput={el.mixerInput}
                          isPgm={!!pgmInput && el.mixerInput === pgmInput}
                          isPvw={!!pvwInput && el.mixerInput === pvwInput}
                          busColor={C_IN}
                          grpBuses={grpBuses}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── AUX tabs — one per bus, direct send view, no drill-down ── */}
          {activeAuxBus !== null && (
            <div className="flex items-stretch overflow-x-auto scrollbar-hide">
              {/* OUT section — AUX bus master */}
              <SectionBar label="OUT" collapsed={auxCollapsed.out} onToggle={() => toggleAuxSection('out')} color={C_AUX.hex} />
              {!auxCollapsed.out && (
                <AuxMasterStrip auxBus={activeAuxBus} label={`AUX ${activeAuxBus}`} send={send} />
              )}
              {/* IN section — per-channel send strips */}
              <SectionBar label="IN" collapsed={auxCollapsed.in} onToggle={() => toggleAuxSection('in')} color={C_IN.hex} />
              {!auxCollapsed.in && (
                <div className="flex">
                  {inputElements.length === 0 ? (
                    <NoContent label="NO INPUTS" />
                  ) : (
                    inputElements.map((el) => (
                      <AuxChannelStrip
                        key={el.elementId}
                        elementId={el.elementId}
                        label={el.label}
                        auxBus={activeAuxBus}
                        send={send}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          )}

        </>
      )}
    </div>
    </FaderDimsCtx.Provider>
  )
}
