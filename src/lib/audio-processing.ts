/**
 * Client mirror of the open-live audio processing contract (OL-25,
 * Eyevinn/open-live#527 / PR #530, shipped in open-live v0.6.0).
 *
 * Source of truth: open-live `src/lib/audio-processing.ts` (stage schemas,
 * ranges, `stageAllowedOnElement`, defaults) and `docs/controller-websocket.md`
 * (`AUDIO_PROC_SET` / `AUDIO_PROC_STATE`). Field names and ranges here are
 * copied from there verbatim. The server REJECTS out-of-range values (NACK /
 * ERROR) and never clamps, so Studio must never put an out-of-range value on
 * the wire: `buildProcSetMessage` refuses to build one.
 */

export const AUDIO_PROC_STAGES = ['gain', 'hpf', 'gate', 'comp', 'eq', 'limiter'] as const
export type AudioProcStage = (typeof AUDIO_PROC_STAGES)[number]

/** One EQ band. `band` is 1..4; the other keys are partial so one knob can move. */
export interface EqBandParams {
  band: number
  freq?: number
  gain?: number
  q?: number
}

/**
 * Params for one stage. Which keys apply depends on the stage (see
 * `STAGE_FIELDS`); every key is optional because `AUDIO_PROC_SET.params` and
 * the optimistic `AUDIO_PROC_STATE` broadcast are partial.
 */
export interface AudioProcParams {
  enabled?: boolean
  gain?: number
  freq?: number
  threshold?: number
  ratio?: number
  attack?: number
  release?: number
  makeup?: number
  knee?: number
  bands?: EqBandParams[]
}

/** Numeric (non-EQ) param keys. */
export type ScalarField = 'gain' | 'freq' | 'threshold' | 'ratio' | 'attack' | 'release' | 'makeup' | 'knee'
/** Numeric EQ band keys. */
export type BandField = 'freq' | 'gain' | 'q'

export interface ParamRange {
  min: number
  max: number
  /** Rounding step for slider output and display. */
  step: number
  unit: string
  label: string
  /** Log-taper slider (frequencies, times). The value itself is never logged. */
  log?: boolean
}

// Ranges mirror open-live src/lib/audio-processing.ts `stageParamSchemas` exactly.
const DB_THRESHOLD: ParamRange = { min: -60, max: 0, step: 0.1, unit: 'dB', label: 'Threshold' }
const ATTACK: ParamRange = { min: 0.1, max: 200, step: 0.1, unit: 'ms', label: 'Attack', log: true }
const RELEASE: ParamRange = { min: 10, max: 1000, step: 1, unit: 'ms', label: 'Release', log: true }

/** Scalar fields per stage, in display order, with their ranges. */
export const STAGE_FIELDS: Record<AudioProcStage, Partial<Record<ScalarField, ParamRange>>> = {
  gain: { gain: { min: -20, max: 20, step: 0.1, unit: 'dB', label: 'Gain' } },
  hpf: { freq: { min: 20, max: 500, step: 1, unit: 'Hz', label: 'Cutoff', log: true } },
  gate: { threshold: DB_THRESHOLD, attack: ATTACK, release: RELEASE },
  comp: {
    threshold: DB_THRESHOLD,
    ratio: { min: 1, max: 20, step: 0.1, unit: ':1', label: 'Ratio' },
    attack: ATTACK,
    release: RELEASE,
    makeup: { min: 0, max: 24, step: 0.1, unit: 'dB', label: 'Makeup' },
    knee: { min: -24, max: 0, step: 0.1, unit: 'dB', label: 'Knee' },
  },
  eq: {},
  limiter: { threshold: { min: -20, max: 0, step: 0.1, unit: 'dB', label: 'Threshold' } },
}

export const EQ_BAND_COUNT = 4
export const EQ_BAND_FIELDS: Record<BandField, ParamRange> = {
  freq: { min: 20, max: 20000, step: 1, unit: 'Hz', label: 'Freq', log: true },
  gain: { min: -15, max: 15, step: 0.1, unit: 'dB', label: 'Gain' },
  q: { min: 0.1, max: 10, step: 0.01, unit: 'Q', label: 'Q', log: true },
}
export const EQ_BAND_NAMES = ['Low', 'Low-Mid', 'Hi-Mid', 'High'] as const

/** Stages with an on/off flag (every stage except input gain). */
export function stageHasEnable(stage: AudioProcStage): boolean {
  return stage !== 'gain'
}

export const STAGE_LABELS: Record<AudioProcStage, string> = {
  gain: 'Input gain',
  hpf: 'High-pass',
  gate: 'Gate',
  comp: 'Compressor',
  eq: 'EQ',
  limiter: 'Limiter',
}

// ── Element / stage compatibility (open-live `stageAllowedOnElement`) ─────────

export function isChannelElement(elementId: string): boolean {
  return /^ch\d+$/.test(elementId)
}

export function isMainElement(elementId: string): boolean {
  return elementId === 'main'
}

/** gain/hpf/gate → channel only; comp/eq → channel or main; limiter → main only. */
export function stageAllowedOnElement(stage: AudioProcStage, elementId: string): boolean {
  const main = isMainElement(elementId)
  const ch = isChannelElement(elementId)
  if (!main && !ch) return false
  switch (stage) {
    case 'gain':
    case 'hpf':
    case 'gate':
      return ch
    case 'comp':
    case 'eq':
      return ch || main
    case 'limiter':
      return main
  }
}

export function stagesForElement(elementId: string): AudioProcStage[] {
  return AUDIO_PROC_STAGES.filter((s) => stageAllowedOnElement(s, elementId))
}

// ── Defaults (open-live `defaultStageParams`, Strom types/src/mixer.rs) ───────

const DEFAULT_EQ_FREQS = [80, 400, 2000, 8000]

export function defaultStageParams(stage: AudioProcStage): AudioProcParams {
  switch (stage) {
    case 'gain':
      return { gain: 0 }
    case 'hpf':
      return { enabled: false, freq: 80 }
    case 'gate':
      return { enabled: false, threshold: -40, attack: 5, release: 100 }
    case 'comp':
      return { enabled: false, threshold: -20, ratio: 4, attack: 10, release: 100, makeup: 0, knee: -6 }
    case 'eq':
      return { enabled: false, bands: DEFAULT_EQ_FREQS.map((freq, i) => ({ band: i + 1, freq, gain: 0, q: 1 })) }
    case 'limiter':
      return { enabled: false, threshold: -3 }
  }
}

// ── Range helpers ─────────────────────────────────────────────────────────────

export function isInRange(value: number, range: ParamRange): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max
}

/** Round to the range's step and clamp into [min, max]. For slider output only. */
export function clampToRange(value: number, range: ParamRange): number {
  if (!Number.isFinite(value)) return range.min
  const decimals = Math.max(0, -Math.floor(Math.log10(range.step)))
  const rounded = Number((Math.round(value / range.step) * range.step).toFixed(decimals))
  return Math.min(range.max, Math.max(range.min, rounded))
}

/** Slider resolution for `valueToSlider` / `sliderToValue`. */
export const SLIDER_STEPS = 1000

/** Map a value to a 0..SLIDER_STEPS slider position (log taper when `range.log`). */
export function valueToSlider(value: number, range: ParamRange): number {
  const v = Math.min(range.max, Math.max(range.min, value))
  const ratio = range.log
    ? Math.log(v / range.min) / Math.log(range.max / range.min)
    : (v - range.min) / (range.max - range.min)
  return Math.round(ratio * SLIDER_STEPS)
}

/** Inverse of `valueToSlider`; the result is rounded and always inside the range. */
export function sliderToValue(pos: number, range: ParamRange): number {
  const ratio = Math.min(1, Math.max(0, pos / SLIDER_STEPS))
  const raw = range.log
    ? range.min * Math.pow(range.max / range.min, ratio)
    : range.min + ratio * (range.max - range.min)
  return clampToRange(raw, range)
}

/** Format a value for display at the range's precision. */
export function formatValue(value: number, range: ParamRange): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(range.step)))
  return value.toFixed(decimals)
}

/**
 * Validate partial params for a stage against the contract. Returns the first
 * problem as text, or null when every key is known and in range. Mirrors the
 * server's `.strict()` schemas so anything this accepts the server accepts.
 */
export function validateStageParams(stage: AudioProcStage, params: AudioProcParams): string | null {
  const fields = STAGE_FIELDS[stage]
  for (const [key, value] of Object.entries(params) as Array<[keyof AudioProcParams, unknown]>) {
    if (value === undefined) continue
    if (key === 'enabled') {
      if (!stageHasEnable(stage)) return `${stage}: unknown key 'enabled'`
      if (typeof value !== 'boolean') return `${stage}: enabled must be a boolean`
      continue
    }
    if (key === 'bands') {
      if (stage !== 'eq') return `${stage}: unknown key 'bands'`
      if (!Array.isArray(value) || value.length > EQ_BAND_COUNT) return 'eq: bands must be an array of at most 4'
      for (const b of value as EqBandParams[]) {
        if (!Number.isInteger(b.band) || b.band < 1 || b.band > EQ_BAND_COUNT) return 'eq: band must be 1..4'
        for (const f of Object.keys(EQ_BAND_FIELDS) as BandField[]) {
          const v = b[f]
          if (v === undefined) continue
          const r = EQ_BAND_FIELDS[f]
          if (typeof v !== 'number' || !isInRange(v, r)) return `eq band ${b.band} ${f}: must be ${r.min} to ${r.max} ${r.unit}`
        }
      }
      continue
    }
    const range = fields[key as ScalarField]
    if (!range) return `${stage}: unknown key '${key}'`
    if (typeof value !== 'number' || !isInRange(value, range)) {
      return `${stage} ${key}: must be ${range.min} to ${range.max} ${range.unit}`
    }
  }
  if (stage === 'gain' && params.gain === undefined) return 'gain: gain is required'
  return null
}

// ── Merge (open-live `mergeStageParams`) ──────────────────────────────────────

/** Merge partial `incoming` onto `existing`; EQ bands merge per band number. */
export function mergeStageParams(existing: AudioProcParams | undefined, incoming: AudioProcParams): AudioProcParams {
  const merged: AudioProcParams = { ...existing, ...incoming }
  if (existing?.bands || incoming.bands) {
    const bands = new Map<number, EqBandParams>()
    for (const b of existing?.bands ?? []) bands.set(b.band, { ...b })
    for (const b of incoming.bands ?? []) bands.set(b.band, { ...bands.get(b.band), ...b })
    merged.bands = [...bands.values()].sort((a, b) => a.band - b.band)
  }
  return merged
}

/** Complete params for display: defaults overlaid by whatever is known. */
export function completeStageParams(stage: AudioProcStage, known: AudioProcParams | undefined): AudioProcParams {
  return known ? mergeStageParams(defaultStageParams(stage), known) : defaultStageParams(stage)
}

/** True when a stage is doing something: enabled, or (input gain) non-zero. */
export function isStageActive(stage: AudioProcStage, params: AudioProcParams): boolean {
  if (stage === 'gain') return (params.gain ?? 0) !== 0
  return params.enabled === true
}

// ── Wire parsing / building ───────────────────────────────────────────────────

function isStage(v: unknown): v is AudioProcStage {
  return typeof v === 'string' && (AUDIO_PROC_STAGES as readonly string[]).includes(v)
}

/** Keep only well-typed contract keys from untrusted params. */
export function parseParams(raw: unknown): AudioProcParams {
  const out: AudioProcParams = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out
  const r = raw as Record<string, unknown>
  if (typeof r['enabled'] === 'boolean') out.enabled = r['enabled']
  for (const k of ['gain', 'freq', 'threshold', 'ratio', 'attack', 'release', 'makeup', 'knee'] as const) {
    const v = r[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  if (Array.isArray(r['bands'])) {
    const bands: EqBandParams[] = []
    for (const b of r['bands'] as unknown[]) {
      if (b === null || typeof b !== 'object') continue
      const rb = b as Record<string, unknown>
      if (typeof rb['band'] !== 'number' || !Number.isInteger(rb['band'])) continue
      const band: EqBandParams = { band: rb['band'] }
      for (const f of ['freq', 'gain', 'q'] as const) {
        const v = rb[f]
        if (typeof v === 'number' && Number.isFinite(v)) band[f] = v
      }
      bands.push(band)
    }
    out.bands = bands
  }
  return out
}

export interface ProcStateFrame {
  elementId: string
  stage: AudioProcStage
  params: AudioProcParams
  applied: boolean
}

/** Parse an inbound `AUDIO_PROC_STATE` frame; null when malformed. */
export function parseProcStateFrame(msg: Record<string, unknown>): ProcStateFrame | null {
  if (msg['type'] !== 'AUDIO_PROC_STATE') return null
  const elementId = msg['elementId']
  const stage = msg['stage']
  if (typeof elementId !== 'string' || !isStage(stage)) return null
  if (!stageAllowedOnElement(stage, elementId)) return null
  return { elementId, stage, params: parseParams(msg['params']), applied: msg['applied'] === true }
}

export interface ProcSetMessage {
  type: 'AUDIO_PROC_SET'
  elementId: string
  stage: AudioProcStage
  params: AudioProcParams
  cmdId?: string
}

/**
 * Build an `AUDIO_PROC_SET` frame, or return the validation error. This is the
 * only constructor Studio uses, so an out-of-range or misplaced value can never
 * be sent.
 */
export function buildProcSetMessage(
  elementId: string,
  stage: AudioProcStage,
  params: AudioProcParams,
  cmdId?: string,
): { ok: true; msg: ProcSetMessage } | { ok: false; error: string } {
  if (!stageAllowedOnElement(stage, elementId)) {
    return { ok: false, error: `stage '${stage}' is not valid on '${elementId}'` }
  }
  const error = validateStageParams(stage, params)
  if (error) return { ok: false, error }
  return { ok: true, msg: { type: 'AUDIO_PROC_SET', elementId, stage, params, ...(cmdId ? { cmdId } : {}) } }
}

/** Store/error key for one stage of one element. */
export function stageKey(elementId: string, stage: AudioProcStage): string {
  return `${elementId}:${stage}`
}
