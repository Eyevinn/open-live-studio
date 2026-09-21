import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import { useAudioStore } from './audio.store.js'
import { usePipelineStore } from './pipeline.store.js'

export type TransitionType =
  | 'fade' | 'dip_to_black'
  | 'slide_left' | 'slide_right' | 'slide_up' | 'slide_down'
  | 'push_left' | 'push_right' | 'push_up' | 'push_down'
  | 'wipe_left' | 'wipe_right' | 'wipe_up' | 'wipe_down'
  | 'iris_open' | 'iris_close' | 'clock_wipe' | 'blinds' | 'checker'
  | 'noise_dissolve' | 'luma_wipe' | 'barn_doors' | 'star_wipe'
  | 'pinwheel' | 'crosshatch' | 'hex_dissolve' | 'warp_wipe' | 'melt' | 'heart_iris'
  | 'glitch_cut' | 'flash_dissolve' | 'whip_pan_left' | 'whip_pan_right'
  | 'punch_zoom' | 'pixelate_take' | 'zoom_blur' | 'spin' | 'tv_roll'
  | 'negative_flash' | 'ripple'

export interface ZoneBorder {
  /** #RRGGBB or #RRGGBBAA hex string */
  color: string
  /** Width in PGM canvas pixels (0–64) */
  width: number
}

export interface PipZone {
  rect: { x: number; y: number; w: number; h: number } | null
  capacity: number | null
  sources: number[]
  /** Border drawn around each source box in this zone. Strom 0.6.6+. */
  border?: ZoneBorder
}

/** Normalized per-source crop: fraction hidden from each edge (0.0–1.0). */
export interface SourceCrop {
  left: number
  top: number
  right: number
  bottom: number
}

/** Map of input index → SourceCrop. Strom 0.6.2+. */
export type PipTransforms = Record<number, SourceCrop>

export interface PipConfig {
  bg: number | null
  zones: PipZone[]
  /** Per-source crop/zoom transforms. Strom 0.6.2+; defaults to {} on older Strom. */
  transforms: PipTransforms
}
// ─── Video effects ─────────────────────────────────────────────────────────────

export type VideoEffect =
  | { type: 'none' }
  | { type: 'chroma_key'; key_color: string; similarity: number; smoothness: number; spill: number }
  | { type: 'pixelate'; block_size: number }
  | { type: 'blur'; radius: number }
  | { type: 'duotone'; low: string; high: string; mix: number }
  | { type: 'vignette'; amount: number; softness: number }
  | { type: 'vhs'; intensity: number }
  | { type: 'old_film'; intensity: number }
  | { type: 'edge_glow'; color: string; intensity: number }
  | { type: 'crt'; intensity: number }
  | { type: 'halftone'; dot_size: number }
  | { type: 'thermal'; intensity: number }
  | { type: 'night_vision'; intensity: number }
  | { type: 'posterize'; levels: number }
  | { type: 'underwater'; intensity: number }
  | { type: 'color_correct'; brightness: number; contrast: number; saturation: number; hue: number; gamma: number; temperature: number; tint: number }

/** Target for a video effect: an input index or the master output. */
export type EffectTarget = { input: number } | 'master'

// ─── Clip playback (epic open-live#206, studio#145) ──────────────────────────────

/** Clip playback state machine, mirroring the backend `ClipState.state`. */
export type ClipPlaybackState =
  | 'idle' | 'cued' | 'playing' | 'paused' | 'stopped' | 'completed' | 'error'

/**
 * Live playback state for a single clip-type source, keyed by its mixerInput.
 * Fed by the controller WS `CLIP_STATE` broadcast (and its connect-time sync);
 * the shape matches the backend `ClipState` contract exactly.
 */
export interface ClipState {
  mixerInput: string
  state: ClipPlaybackState
  clipId?: string
  positionMs?: number
  durationMs?: number
  error?: string
}

interface ProductionState {
  /** Active mixer input on program, e.g. "video_in_0" */
  pgmInput: string | null
  /** Active mixer input on preview */
  pvwInput: string | null
  isFtb: boolean
  transitionType: TransitionType
  transitionDurationMs: number
  tBarPosition: number // 0.0–1.0
  activeProductionId: string | null
  /** Server-confirmed DSK layer visibility: layer index → visible */
  dskState: Record<number, boolean>
  /** Runtime source time offsets: mixerInput → offsetMs. Synced via WS, reset on production change. */
  sourceOffsets: Record<string, number>
  /** Runtime source audio time offsets: mixerInput → offsetMs. Synced via WS, reset on production change. */
  sourceAudioOffsets: Record<string, number>
  /** AFV ramp durations synced from server. Defaults: rampUpMs=300, rampDownMs=50. */
  afvRampUpMs: number
  afvRampDownMs: number
  pgmPip: number | null
  pvwPip: number | null
  pips: PipConfig[]
  /** Whether GPU FX backend is available (from server FX_STATE message). */
  fxAvailable: boolean
  /** Per-input video effects: input index → VideoEffect. */
  inputEffects: Record<number, VideoEffect>
  /** Master output video effect. */
  masterEffect: VideoEffect
  /**
   * Live clip playback state per clip-type source, keyed by mixerInput. Synced
   * from the controller WS `CLIP_STATE` broadcast (epic open-live#206, studio#145).
   * Reset on production change; the connect-time sync repopulates it.
   */
  clipStates: Record<string, ClipState>
  /** Set when a PRODUCTION_DEACTIVATED message is received while this client is in the studio. */
  deactivatedExternally: boolean
  /**
   * Why the production was deactivated out from under this client. Drives the
   * post-deactivation message so an idle auto-timeout isn't wrongly attributed
   * to another user (#130). `'idle'` = idle-timeout auto-deactivation,
   * `'external'` = deactivated by another user / other cause.
   */
  deactivationReason: 'idle' | 'external' | null
  /**
   * Pre-deactivation idle warning surfaced in the mixer view (#130). Populated
   * from the backend idle-warning WS signal (paired backend work: open-live#290).
   * `deadlineMs` is the wall-clock epoch (ms) at which auto-deactivation fires,
   * so the countdown stays accurate across re-renders and clock ticks.
   */
  idleWarning: { deadlineMs: number } | null
}

interface ProductionActions {
  cut: () => void
  auto: () => void
  ftb: () => void
  setPvw: (mixerInput: string) => void
  setPgm: (mixerInput: string) => void
  setTransitionType: (type: TransitionType) => void
  setTransitionDuration: (ms: number) => void
  setTBarPosition: (pos: number) => void
  setActiveProduction: (id: string | null) => void
  setDskState: (layer: number, visible: boolean) => void
  /** Server-authoritative offset setter — called by WS handler on SOURCE_OFFSET_STATE */
  applySourceOffset: (mixerInput: string, offsetMs: number) => void
  /** Server-authoritative audio offset setter — called by WS handler on SOURCE_AUDIO_OFFSET_STATE */
  applySourceAudioOffset: (mixerInput: string, offsetMs: number) => void
  /** Clear all source offsets — called on PRODUCTION_DEACTIVATED */
  resetSourceOffsets: () => void
  /** Server-authoritative AFV ramp setter — called by WS handler on AFV_RAMP_STATE */
  applyAfvRamp: (rampUpMs: number, rampDownMs: number) => void
  applyPipState: (pgmPip: number | null, pvwPip: number | null, pips: PipConfig[]) => void
  applyPipConfig: (pipIdx: number, config: PipConfig) => void
  setPvwPip: (pip: number | null) => void
  /** Server-authoritative FX state setter — called by WS handler on FX_STATE */
  applyFxState: (fxAvailable: boolean, inputEffects: VideoEffect[], masterEffect: VideoEffect) => void
  /** Server-authoritative clip state setter — called by WS handler on CLIP_STATE */
  applyClipState: (clip: ClipState) => void
  setDeactivatedExternally: (value: boolean) => void
  /** Record why the production was deactivated; also flips deactivatedExternally on. */
  setDeactivated: (reason: 'idle' | 'external') => void
  /** Set (or clear with null) the pending idle-timeout warning shown in the mixer view. */
  setIdleWarning: (warning: { deadlineMs: number } | null) => void
}

export const useProductionStore = create<ProductionState & ProductionActions>()(
  devtools(
    immer((set) => ({
      // State
      pgmInput: null,
      pvwInput: null,
      isFtb: false,
      transitionType: 'fade',
      transitionDurationMs: 1000,
      tBarPosition: 1,
      activeProductionId: null,
      dskState: {},
      sourceOffsets: {},
      sourceAudioOffsets: {},
      afvRampUpMs: 300,
      afvRampDownMs: 50,
      pgmPip: null,
      pvwPip: null,
      pips: [],
      fxAvailable: false,
      inputEffects: {},
      masterEffect: { type: 'none' as const },
      clipStates: {},
      deactivatedExternally: false,
      deactivationReason: null,
      idleWarning: null,

      // Actions
      cut: () =>
        set((state) => {
          const temp = state.pgmInput
          state.pgmInput = state.pvwInput
          state.pvwInput = temp
          state.isFtb = false
        }),

      auto: () =>
        set((state) => {
          const temp = state.pgmInput
          state.pgmInput = state.pvwInput
          state.pvwInput = temp
          state.isFtb = false
        }),

      ftb: () =>
        set((state) => {
          state.isFtb = !state.isFtb
        }),

      setPvw: (mixerInput) =>
        set((state) => {
          state.pvwInput = mixerInput
        }),

      setPgm: (mixerInput) =>
        set((state) => {
          state.pgmInput = mixerInput
        }),

      setTransitionType: (type) =>
        set((state) => {
          state.transitionType = type
        }),

      setTransitionDuration: (ms) =>
        set((state) => {
          state.transitionDurationMs = ms
        }),

      setTBarPosition: (pos) =>
        set((state) => {
          state.tBarPosition = Math.max(0, Math.min(1, pos))
        }),

      setActiveProduction: (id) => {
        set((state) => {
          state.activeProductionId = id
          state.pgmInput = null
          state.pvwInput = null
          state.isFtb = false
          state.tBarPosition = 1
          state.dskState = {}
          state.sourceOffsets = {}
          state.sourceAudioOffsets = {}
          state.afvRampUpMs = 300
          state.afvRampDownMs = 50
          state.pgmPip = null
          state.pvwPip = null
          state.pips = []
          state.clipStates = {}
          state.idleWarning = null
          state.deactivationReason = null
        })
        // Clear audio strips synchronously so the new production never renders with
        // a previous production's elements. React 18 batches these two store updates
        // into one render, so the user never sees stale strips.
        useAudioStore.setState({ elements: [], productionId: id ?? null, levels: {}, muted: {}, meters: {} })
        // Clear pipeline runtime state
        usePipelineStore.setState({ stromJson: '', executionState: 'idle', uptimeSeconds: 0, parseError: null })
      },

      setDskState: (layer, visible) =>
        set((state) => {
          state.dskState[layer] = visible
        }),

      applySourceOffset: (mixerInput, offsetMs) =>
        set((state) => {
          state.sourceOffsets[mixerInput] = offsetMs
        }),

      applySourceAudioOffset: (mixerInput, offsetMs) =>
        set((state) => {
          state.sourceAudioOffsets[mixerInput] = offsetMs
        }),

      resetSourceOffsets: () =>
        set((state) => {
          state.sourceOffsets = {}
          state.sourceAudioOffsets = {}
        }),

      applyAfvRamp: (rampUpMs, rampDownMs) =>
        set((state) => {
          state.afvRampUpMs = rampUpMs
          state.afvRampDownMs = rampDownMs
        }),

      applyPipState: (pgmPip, pvwPip, pips) =>
        set((state) => {
          state.pgmPip = pgmPip
          state.pvwPip = pvwPip
          // Normalise incoming pips to always have transforms (older Strom omits it)
          state.pips = pips.map((p) => ({ ...p, transforms: p.transforms ?? {} }))
        }),

      applyPipConfig: (pipIdx, config) =>
        set((state) => {
          state.pips[pipIdx] = { ...config, transforms: config.transforms ?? {} }
        }),

      setPvwPip: (pip) =>
        set((state) => {
          state.pvwPip = pip
        }),

      applyFxState: (fxAvailable, inputEffects, masterEffect) =>
        set((state) => {
          state.fxAvailable = fxAvailable
          state.inputEffects = Object.fromEntries(inputEffects.map((e, i) => [i, e]))
          state.masterEffect = masterEffect
        }),

      applyClipState: (clip) =>
        set((state) => {
          state.clipStates[clip.mixerInput] = clip
        }),

      setDeactivatedExternally: (value) =>
        set((state) => {
          state.deactivatedExternally = value
          if (!value) state.deactivationReason = null
        }),

      setDeactivated: (reason) =>
        set((state) => {
          state.deactivatedExternally = true
          state.deactivationReason = reason
          // A completed deactivation supersedes any pending idle warning.
          state.idleWarning = null
        }),

      setIdleWarning: (warning) =>
        set((state) => { state.idleWarning = warning }),
    })),
    { name: 'production', enabled: import.meta.env.DEV },
  ),
)
