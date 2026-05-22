import { useEffect, useCallback, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { useWebRTC } from '@/hooks/useWebRTC'
import { useControllerWs } from '@/hooks/useControllerWs'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { useTemplatesStore } from '@/store/templates.store'
import { useGraphicsStore } from '@/store/graphics.store'
import { useOutputsStore } from '@/store/outputs.store'
import { useAudioStore } from '@/store/audio.store'
import { useViewerStore } from '@/store/viewer.store'
import { audioApi } from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ProgramPreview } from '@/pages/ControllerPage/ProgramPreview'
import { TransitionPanel } from '@/pages/ControllerPage/TransitionPanel'
import { DskPanel } from '@/pages/ControllerPage/DskPanel'
import { AudioPanel } from '@/pages/ControllerPage/AudioPanel'

// ─── Icons ────────────────────────────────────────────────────────────────────

function GearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}

function FullscreenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

function ExitFullscreenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
      <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
    </svg>
  )
}

function MuteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

function MutedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}

function MultiviewerIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="3" width="20" height="15" rx="2" />
      <line x1="12" y1="3" x2="12" y2="18" strokeOpacity="0.5" />
      <line x1="2" y1="10.5" x2="22" y2="10.5" strokeOpacity="0.5" />
      <path d="M8 22h8M12 18v4" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

function ControllerIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6"  x2="21" y2="6"  />
      <line x1="3" y1="18" x2="21" y2="18" />
      <line x1="12" y1="6" x2="12" y2="18" strokeWidth="1" strokeOpacity="0.35" />
      <rect x="7" y="10" width="10" height="4" rx="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function AudioIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9v6h4l5 5V4L7 9H3Z" />
      <path d="M17.5 8.5a6 6 0 0 1 0 7" />
    </svg>
  )
}

// ─── Controller pane — zoomed to 50% of viewport height ──────────────────────

const CONTROLLER_TARGET = 0.5  // fraction of viewport height the content should occupy

function ControllerPaneContent({ onCut, onAuto, onFtb, onSelectPvw, onSetOvl, onDskToggle, visibleTransitions }: {
  onCut: () => void; onAuto: () => void; onFtb: () => void
  onSelectPvw: (m: string) => void; onSetOvl: (a: number) => void
  onDskToggle: (l: number, v: boolean) => void
  visibleTransitions: string[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef   = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    let naturalH = 0
    const compute = () => {
      if (!containerRef.current || !contentRef.current) return
      if (naturalH === 0) naturalH = contentRef.current.offsetHeight
      const availH = containerRef.current.clientHeight
      if (naturalH > 0 && availH > 0) setZoom((availH * CONTROLLER_TARGET) / naturalH)
    }
    const raf = requestAnimationFrame(compute)
    window.addEventListener('resize', compute)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', compute) }
  }, [])

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden">
      {/* No height override — let content size itself naturally so offsetHeight captures the real content height */}
      <div ref={contentRef} style={{ zoom }}>
        <div className="p-4 flex flex-col gap-3">
          <TransitionPanel onCut={onCut} onAuto={onAuto} onFtb={onFtb} onSelectPvw={onSelectPvw} onSetOvl={onSetOvl} visibleTransitions={visibleTransitions} />
          <DskPanel onToggle={onDskToggle} />
        </div>
      </div>
    </div>
  )
}

// ─── Shared pane header ───────────────────────────────────────────────────────

function PaneBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 shrink-0 px-2 py-1 border-b border-zinc-800 text-[--color-text-muted]">
      {children}
    </div>
  )
}

// ─── Persisted options keys (mirrors ControllerPage) ─────────────────────────

const AUDIO_OPTIONS_KEY      = 'ol-studio-audio-options'
const CONTROLLER_OPTIONS_KEY = 'ol-studio-controller-options'

const ALL_TRANSITIONS = ['fade', 'slide_left', 'slide_right', 'slide_up', 'slide_down'] as const
const DEFAULT_TRANSITIONS = ['fade', 'slide_left', 'slide_right']
const TRANSITION_LABELS: Record<string, string> = {
  fade: 'Fade', slide_left: 'Push Left', slide_right: 'Push Right',
  slide_up: 'Push Up', slide_down: 'Push Down',
}

type Pane = 'multiviewer' | 'controller' | 'audio' | 'pgm'

// ─── PGM confidence monitor ───────────────────────────────────────────────────

interface PgmChannel { label: string; url: string }

// Labels for the two audio tracks wired by flow-generator: track 0 = programme mix,
// track 1 = monitor/PFL bus.

// Natural fader height in the AudioPanel at zoom=1 (matches FADER_H in AudioPanel.tsx)
const NATURAL_FADER_H = 260

function AudioPaneFullscreen({ send, numAuxBuses, numGroups, showEbuMain }: {
  send: ReturnType<typeof useControllerWs>
  numAuxBuses?: number
  numGroups?: number
  showEbuMain?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const compute = () => {
      const availH = containerRef.current?.clientHeight ?? 0
      // Target: faders occupy 70% of viewport height after zoom.
      // zoom = targetFaderH / naturalFaderH
      if (availH > 0) setZoom((availH * 0.5) / NATURAL_FADER_H)
    }
    const raf = requestAnimationFrame(compute)
    window.addEventListener('resize', compute)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', compute) }
  }, [])

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden scrollbar-hide">
      {/* height inverse of zoom keeps the panel filling exactly one screen height after scaling */}
      <div style={{ zoom, height: `${100 / zoom}%` }}>
        <AudioPanel send={send} numAuxBuses={numAuxBuses} numGroups={numGroups} showEbuMain={showEbuMain} />
      </div>
    </div>
  )
}

export function PanePage() {
  const { pane } = useParams<{ pane: Pane }>()
  const [searchParams] = useSearchParams()
  const productionId = searchParams.get('production')

  // No Shell in this route — bootstrap all store data ourselves
  const fetchProductions = useProductionsStore((s) => s.fetchAll)
  const fetchSources     = useSourcesStore((s) => s.fetchAll)
  const fetchTemplates   = useTemplatesStore((s) => s.fetchAll)
  const fetchGraphics    = useGraphicsStore((s) => s.fetchAll)
  const fetchOutputs     = useOutputsStore((s) => s.fetchAll)

  useEffect(() => {
    void fetchTemplates()
    void fetchGraphics()
    void fetchOutputs()
  }, [fetchTemplates, fetchGraphics, fetchOutputs])

  useEffect(() => {
    void fetchSources()
    void fetchProductions()
    const id = setInterval(() => { void fetchSources(); void fetchProductions() }, 5000)
    return () => clearInterval(id)
  }, [fetchSources, fetchProductions])

  const { cut, auto, ftb, setPvw, pvwInput, transitionType, transitionDurationMs, setActiveProduction } = useProductionStore()
  const activeProduction   = useProductionsStore((s) => s.productions.find((p) => p.id === productionId))
  const whepEndpoint       = useProductionsStore((s) => s.productions.find((p) => p.id === productionId)?.whepEndpoint)
  const pgmWhepEndpoint    = useProductionsStore((s) => s.productions.find((p) => p.id === productionId)?.pgmWhepEndpoint)
  const whepOutputUrls     = useProductionsStore((s) => s.productions.find((p) => p.id === productionId)?.whepOutputUrls)
  const outputs            = useOutputsStore((s) => s.outputs)

  // Build the ordered channel list: PGM first, then named WHEP outputs.
  const pgmChannels: PgmChannel[] = [
    ...(pgmWhepEndpoint ? [{ label: 'PGM', url: pgmWhepEndpoint }] : []),
    ...(whepOutputUrls ?? []).map(({ outputId, url }) => ({
      label: outputs.find((o) => o.id === outputId)?.name ?? 'Output',
      url,
    })),
  ]

  const [selectedPgmUrl, setSelectedPgmUrl] = useState<string | undefined>(undefined)
  const [selectedMvUrl, setSelectedMvUrl] = useState<string | undefined>(undefined)
  const { audioTrackCount } = useViewerStore()
  const [mvAudioOn, setMvAudioOn] = useState(false)
  const [mvAudioTrack, setMvAudioTrack] = useState(1)
  const [pgmAudioOn, setPgmAudioOn] = useState(false)
  const [pgmAudioTrack, setPgmAudioTrack] = useState(0)

  // Fullscreen
  const paneRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])
  const handleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void paneRef.current?.requestFullscreen()
  }, [])

  // Audio options (mirrors ControllerPage)
  const [audioOptionsOpen, setAudioOptionsOpen] = useState(false)
  const [rampMs, setRampMs] = useState<number>(() => {
    try { return (JSON.parse(localStorage.getItem(AUDIO_OPTIONS_KEY) ?? '{}') as { rampMs?: number }).rampMs ?? 200 } catch { return 200 }
  })
  const [rampMsText, setRampMsText] = useState(() => String(rampMs))
  useEffect(() => { if (audioOptionsOpen) setRampMsText(String(rampMs)) }, [audioOptionsOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Controller options (mirrors ControllerPage)
  const [controllerOptionsOpen, setControllerOptionsOpen] = useState(false)
  const [visibleTransitions, setVisibleTransitions] = useState<string[]>(() => {
    try {
      const vt = (JSON.parse(localStorage.getItem(CONTROLLER_OPTIONS_KEY) ?? '{}') as { visibleTransitions?: string[] }).visibleTransitions ?? []
      const valid = vt.filter((t) => (ALL_TRANSITIONS as readonly string[]).includes(t))
      return valid.length > 0 ? valid : [...DEFAULT_TRANSITIONS]
    } catch { return [...DEFAULT_TRANSITIONS] }
  })

  // Default PGM pane to first channel when channels first become available.
  useEffect(() => {
    if (!selectedPgmUrl && pgmChannels.length > 0) setSelectedPgmUrl(pgmChannels[0]!.url)
  }, [pgmChannels.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (productionId) setActiveProduction(productionId)
  }, [productionId, setActiveProduction])

  useWebRTC(
    pane === 'multiviewer' ? (selectedMvUrl ?? whepEndpoint ?? null) :
    pane === 'pgm'         ? (selectedPgmUrl ?? pgmWhepEndpoint ?? null) :
    null
  )
  const send = useControllerWs(pane !== 'multiviewer' ? productionId : null)

  const setElements = useAudioStore((s) => s.setElements)
  useEffect(() => {
    if (!productionId) return
    setElements([], productionId)
    if (activeProduction?.status !== 'active') return
    let cancelled = false
    void audioApi.discoverElements(productionId).then((elements) => {
      if (!cancelled) setElements(elements, productionId)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [productionId, activeProduction?.status, setElements])

  const handleCut       = useCallback(() => { cut(); send({ type: 'CUT', mixerInput: pvwInput ?? '' }) }, [cut, send, pvwInput])
  const handleAuto      = useCallback(() => { auto(); send({ type: 'TRANSITION', mixerInput: pvwInput ?? '', transitionType, durationMs: transitionDurationMs }) }, [auto, send, pvwInput, transitionType, transitionDurationMs])
  const handleFtb       = useCallback(() => { ftb(); send({ type: 'FTB', durationMs: transitionDurationMs }) }, [ftb, send, transitionDurationMs])
  const handleSetOvl    = useCallback((alpha: number) => { send({ type: 'SET_OVL', alpha }) }, [send])
  const handleSelectPvw = useCallback((mixerInput: string) => { setPvw(mixerInput); send({ type: 'SET_PVW', mixerInput }) }, [setPvw, send])
  const handleDskToggle = (layer: number, visible: boolean) => { send({ type: 'DSK_TOGGLE', layer, visible }) }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (pane !== 'controller') return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.code === 'Space') { e.preventDefault(); handleCut() }
    if (e.code === 'Enter') { e.preventDefault(); handleAuto() }
  }, [pane, handleCut, handleAuto])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <>
    <div ref={paneRef} className="h-screen w-screen bg-[--color-surface-1] overflow-hidden flex flex-col">

      {/* ── Multiviewer ─────────────────────────────────────────────────────── */}
      {pane === 'multiviewer' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <PaneBar>
            <MultiviewerIcon />
            <span className="text-[10px] font-semibold uppercase tracking-widest">Multiviewer</span>
            {audioTrackCount > 1 && (
              <select value={mvAudioTrack} onChange={(e) => setMvAudioTrack(parseInt(e.target.value, 10))}
                className="text-[9px] font-bold uppercase tracking-widest cursor-pointer bg-zinc-900 border border-zinc-700 text-zinc-400 px-1 py-0.5 focus:outline-none focus:border-orange-500"
              >
                {Array.from({ length: audioTrackCount }, (_, i) => i === 0 ? 'PGM' : i === 1 ? 'MON' : `AUX${i - 1}`).map((label, i) => (
                  <option key={i} value={i}>{label}</option>
                ))}
              </select>
            )}
            {audioTrackCount > 0 && (
              <button onClick={() => setMvAudioOn(v => !v)} title={mvAudioOn ? 'Mute monitor' : 'Unmute monitor'}
                className={`cursor-pointer transition-colors ${mvAudioOn ? 'text-orange-500' : 'text-[--color-text-muted] hover:text-[--color-text-primary]'}`}
              >{mvAudioOn ? <MuteIcon /> : <MutedIcon />}</button>
            )}
            <button onClick={handleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="cursor-pointer hover:text-[--color-text-primary] transition-colors"
            >{isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}</button>
          </PaneBar>
          <div className="flex-1 min-h-0 flex items-center justify-center p-2">
            <ProgramPreview audioOn={mvAudioOn} onAudioOnChange={setMvAudioOn} audioTrack={mvAudioTrack} onAudioTrackChange={setMvAudioTrack} />
          </div>
        </div>
      )}

      {/* ── Controller ──────────────────────────────────────────────────────── */}
      {pane === 'controller' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <PaneBar>
            <ControllerIcon />
            <span className="text-[10px] font-semibold uppercase tracking-widest">Controller</span>
            <button onClick={() => setControllerOptionsOpen(true)} title="Controller options"
              className="cursor-pointer hover:text-[--color-text-primary] transition-colors"
            ><GearIcon /></button>
          </PaneBar>
          <ControllerPaneContent
            onCut={handleCut} onAuto={handleAuto} onFtb={handleFtb}
            onSelectPvw={handleSelectPvw} onSetOvl={handleSetOvl}
            onDskToggle={handleDskToggle}
            visibleTransitions={visibleTransitions}
          />
        </div>
      )}

      {/* ── Audio ───────────────────────────────────────────────────────────── */}
      {pane === 'audio' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <PaneBar>
            <AudioIcon />
            <span className="text-[10px] font-semibold uppercase tracking-widest">Audio</span>
            <button onClick={() => setAudioOptionsOpen(true)} title="Audio options"
              className="cursor-pointer hover:text-[--color-text-primary] transition-colors"
            ><GearIcon /></button>
          </PaneBar>
          <AudioPaneFullscreen
            send={send}
            numAuxBuses={activeProduction?.values?.num_aux_buses !== undefined ? parseInt(String(activeProduction.values.num_aux_buses), 10) : 2}
            numGroups={activeProduction?.values?.num_groups !== undefined ? parseInt(String(activeProduction.values.num_groups), 10) : 2}
            showEbuMain={activeProduction?.values?.ebu_main === true}
          />
        </div>
      )}

      {/* ── PGM ─────────────────────────────────────────────────────────────── */}
      {pane === 'pgm' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <PaneBar>
            <MonitorIcon />
            <span className="text-[10px] font-semibold uppercase tracking-widest">PGM</span>
            {audioTrackCount > 1 && (
              <select value={pgmAudioTrack} onChange={(e) => setPgmAudioTrack(parseInt(e.target.value, 10))}
                className="text-[9px] font-bold uppercase tracking-widest cursor-pointer bg-zinc-900 border border-zinc-700 text-zinc-400 px-1 py-0.5 focus:outline-none focus:border-orange-500"
              >
                {Array.from({ length: audioTrackCount }, (_, i) => i === 0 ? 'PGM' : i === 1 ? 'MON' : `AUX${i - 1}`).map((label, i) => (
                  <option key={i} value={i}>{label}</option>
                ))}
              </select>
            )}
            {audioTrackCount > 0 && (
              <button onClick={() => setPgmAudioOn(v => !v)} title={pgmAudioOn ? 'Mute monitor' : 'Unmute monitor'}
                className={`cursor-pointer transition-colors ${pgmAudioOn ? 'text-orange-500' : 'text-[--color-text-muted] hover:text-[--color-text-primary]'}`}
              >{pgmAudioOn ? <MuteIcon /> : <MutedIcon />}</button>
            )}
            <button onClick={handleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="cursor-pointer hover:text-[--color-text-primary] transition-colors"
            >{isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}</button>
          </PaneBar>
          <div className="flex-1 min-h-0 flex items-center justify-center p-2">
            <ProgramPreview noSignal={activeProduction?.status !== 'active'} audioOn={pgmAudioOn} onAudioOnChange={setPgmAudioOn} audioTrack={pgmAudioTrack} onAudioTrackChange={setPgmAudioTrack} />
          </div>
        </div>
      )}

    </div>

    {/* ── Audio options modal ──────────────────────────────────────────────── */}
    <Modal open={audioOptionsOpen} title="Audio Options" onClose={() => setAudioOptionsOpen(false)} className="max-w-xs">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <label className="text-xs text-[--color-text-muted] shrink-0">Ramp Time</label>
          <input type="number" min={0} max={5000} step={50} value={rampMsText}
            onChange={(e) => {
              setRampMsText(e.target.value)
              const parsed = parseInt(e.target.value, 10)
              if (!isNaN(parsed) && parsed >= 0 && parsed <= 5000) {
                setRampMs(parsed)
                try { localStorage.setItem(AUDIO_OPTIONS_KEY, JSON.stringify({ rampMs: parsed })) } catch {}
              }
            }}
            onBlur={() => {
              const parsed = parseInt(rampMsText, 10)
              const clamped = isNaN(parsed) ? 200 : Math.max(0, Math.min(5000, parsed))
              setRampMsText(String(clamped)); setRampMs(clamped)
              try { localStorage.setItem(AUDIO_OPTIONS_KEY, JSON.stringify({ rampMs: clamped })) } catch {}
            }}
            className="bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[--color-accent] w-20"
          />
          <span className="text-xs text-[--color-text-muted] shrink-0">ms</span>
        </div>
        <div className="flex justify-end">
          <Button variant="active" size="sm" onClick={() => setAudioOptionsOpen(false)}>Done</Button>
        </div>
      </div>
    </Modal>

    {/* ── Controller options modal ─────────────────────────────────────────── */}
    <Modal open={controllerOptionsOpen} title="Controller Options" onClose={() => setControllerOptionsOpen(false)} className="max-w-xs">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-[--color-text-muted]">Visible transitions</span>
          {ALL_TRANSITIONS.map((t) => {
            const checked = visibleTransitions.includes(t)
            const isLast = visibleTransitions.length === 1 && checked
            return (
              <label key={t} className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={checked} disabled={isLast}
                  onChange={() => {
                    const next = checked ? visibleTransitions.filter((x) => x !== t) : [...visibleTransitions, t]
                    setVisibleTransitions(next)
                    try { localStorage.setItem(CONTROLLER_OPTIONS_KEY, JSON.stringify({ visibleTransitions: next })) } catch {}
                  }}
                  className="accent-orange-500"
                />
                <span className="text-[11px] text-[--color-text-primary]">{TRANSITION_LABELS[t] ?? t}</span>
              </label>
            )
          })}
        </div>
        <div className="flex justify-end">
          <Button variant="active" size="sm" onClick={() => setControllerOptionsOpen(false)}>Done</Button>
        </div>
      </div>
    </Modal>
    </>
  )
}
