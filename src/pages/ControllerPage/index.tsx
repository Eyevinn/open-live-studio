import { useEffect, useCallback, useState, useRef, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useWebRTC } from '@/hooks/useWebRTC'
import { useControllerWs } from '@/hooks/useControllerWs'
import { PageHeader } from '@/components/layout/PageHeader'
import { ProgramPreview, type ProgramPreviewHandle } from './ProgramPreview'
import { PgmPreview } from './PgmPreview'
import { TransitionPanel } from './TransitionPanel'
import { DskPanel } from './DskPanel'
import { MacroBar } from './MacroBar'
import { AudioPanel } from './AudioPanel'
import { TimerBar } from './TimerBar'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { useProductionStore } from '@/store/production.store'
import { useIsOnAir } from '@/store/programClock.store'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { useGraphicsStore } from '@/store/graphics.store'
import { useAudioStore } from '@/store/audio.store'
import { audioApi } from '@/lib/api'

// ─── Panel layout persistence ─────────────────────────────────────────────────

const PANELS_STORAGE_KEY = 'ol-studio-panels'

type Panels = { multiviewer: boolean; controller: boolean; audio: boolean; pgm: boolean }

function loadPanels(): Panels {
  try {
    const raw = localStorage.getItem(PANELS_STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Panels>
      return {
        multiviewer: p.multiviewer !== false,
        controller:  p.controller  !== false,
        audio:       p.audio       !== false,
        pgm:         p.pgm         !== false,
      }
    }
  } catch {}
  return { multiviewer: true, controller: true, audio: true, pgm: true }
}

function savePanels(panels: Panels) {
  try { localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(panels)) } catch {}
}

// ─── Panel options persistence ────────────────────────────────────────────────

const ALL_TRANSITIONS = ['fade', 'slide_left', 'slide_right', 'slide_up', 'slide_down'] as const
const DEFAULT_TRANSITIONS = ['fade', 'slide_left', 'slide_right']

const TRANSITION_LABELS: Record<string, string> = {
  fade:        'Fade',
  slide_left:  'Push Left',
  slide_right: 'Push Right',
  slide_up:    'Push Up',
  slide_down:  'Push Down',
}

const AUDIO_OPTIONS_KEY      = 'ol-studio-audio-options'
const CONTROLLER_OPTIONS_KEY = 'ol-studio-controller-options'

type AudioOptions      = { rampMs: number }
type ControllerOptions = { visibleTransitions: string[] }

function loadAudioOptions(): AudioOptions {
  try {
    const raw = localStorage.getItem(AUDIO_OPTIONS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<AudioOptions>
      return { rampMs: typeof p.rampMs === 'number' ? p.rampMs : 200 }
    }
  } catch {}
  return { rampMs: 200 }
}

function loadControllerOptions(): ControllerOptions {
  try {
    const raw = localStorage.getItem(CONTROLLER_OPTIONS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<ControllerOptions>
      const vt = Array.isArray(p.visibleTransitions) ? p.visibleTransitions.filter((t) => (ALL_TRANSITIONS as readonly string[]).includes(t)) : []
      return { visibleTransitions: vt.length > 0 ? vt : DEFAULT_TRANSITIONS }
    }
  } catch {}
  return { visibleTransitions: DEFAULT_TRANSITIONS }
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="2" x2="14" y2="14" />
      <line x1="14" y1="2" x2="2" y2="14" />
    </svg>
  )
}
function GearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}
function PopOutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 2H2v12h12V9" />
      <path d="M10 2h4v4" />
      <line x1="14" y1="2" x2="7" y2="9" />
    </svg>
  )
}

function SectionLabel({ icon, children, onPopOut, onHide, actions }: { icon: ReactNode; children: string; onPopOut?: () => void; onHide?: () => void; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[--color-text-muted]">
      {icon}
      <span className="text-[10px] font-semibold uppercase tracking-widest">{children}</span>
      {actions}
      {onPopOut && (
        <button
          type="button"
          onClick={onPopOut}
          title={`Pop out ${children}`}
          className="cursor-pointer hover:text-[--color-text-primary] transition-colors"
        >
          <PopOutIcon />
        </button>
      )}
      {onHide && (
        <button
          type="button"
          onClick={onHide}
          title={`Hide ${children}`}
          className="cursor-pointer hover:text-[--color-text-primary] transition-colors"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}

function MuteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

function MutedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}

function FullscreenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

function ExitFullscreenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="10" y1="14" x2="3" y2="21" />
      <line x1="21" y1="3" x2="14" y2="10" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

function MultiviewerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="3" width="20" height="15" rx="2" />
      <line x1="12" y1="3" x2="12" y2="18" strokeOpacity="0.5" />
      <line x1="2" y1="10.5" x2="22" y2="10.5" strokeOpacity="0.5" />
      <path d="M8 22h8M12 18v4" />
    </svg>
  )
}

function ControllerIcon() {
  // T-bar: two bus rails (PGM top, PVW bottom) with a sliding handle — the iconic production switcher control
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6"  x2="21" y2="6"  />
      <line x1="3" y1="18" x2="21" y2="18" />
      <line x1="12" y1="6" x2="12" y2="18" strokeWidth="1" strokeOpacity="0.35" />
      <rect x="7" y="10" width="10" height="4" rx="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function AudioIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9v6h4l5 5V4L7 9H3Z" />
      <path d="M17.5 8.5a6 6 0 0 1 0 7" />
    </svg>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ControllerPage() {
  const { cut, auto, ftb, setPvw, pvwInput, transitionType, transitionDurationMs, activeProductionId, setActiveProduction } = useProductionStore()
  const productions = useProductionsStore((s) => s.productions)
  const fetchProductions = useProductionsStore((s) => s.fetchAll)
  const fetchSources = useSourcesStore((s) => s.fetchAll)
  const fetchGraphics = useGraphicsStore((s) => s.fetchAll)
  const activeProduction = useProductionsStore((s) => s.productions.find((p) => p.id === activeProductionId))
  const whepEndpoint = useProductionsStore(
    (s) => s.productions.find((p) => p.id === activeProductionId)?.whepEndpoint,
  )
  const pgmWhepEndpoint = useProductionsStore(
    (s) => s.productions.find((p) => p.id === activeProductionId)?.pgmWhepEndpoint,
  )
  const isOnAir = useIsOnAir()

  useEffect(() => {
    void fetchProductions()
    void fetchSources()
    void fetchGraphics()
  }, [fetchProductions, fetchSources, fetchGraphics])

  const [searchParams] = useSearchParams()
  const [panels, setPanels] = useState<Panels>(loadPanels)
  const [multiviewerMuted, setMultiviewerMuted] = useState(true)
  const [pgmMuted, setPgmMuted] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPgmFullscreen, setIsPgmFullscreen] = useState(false)
  const [audioOptions, setAudioOptions] = useState<AudioOptions>(loadAudioOptions)
  const [controllerOptions, setControllerOptions] = useState<ControllerOptions>(loadControllerOptions)
  const [audioOptionsOpen, setAudioOptionsOpen] = useState(false)
  const [rampMsText, setRampMsText] = useState(() => String(loadAudioOptions().rampMs))
  useEffect(() => { if (audioOptionsOpen) setRampMsText(String(audioOptions.rampMs)) }, [audioOptionsOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  const [controllerOptionsOpen, setControllerOptionsOpen] = useState(false)
  const multiviewerRef = useRef<HTMLDivElement>(null)
  const pgmRef = useRef<HTMLDivElement>(null)
  const programPreviewRef = useRef<ProgramPreviewHandle>(null)

  const togglePanel = (key: keyof Panels) => {
    setPanels(prev => {
      const next = { ...prev, [key]: !prev[key] }
      savePanels(next)
      return next
    })
  }

  useEffect(() => {
    const paramId = searchParams.get('production')
    if (paramId) {
      if (paramId !== activeProductionId) setActiveProduction(paramId)
      return
    }
    if (activeProductionId) return
    const active = [...productions].reverse().find((p) => p.status === 'active')
    if (active) setActiveProduction(active.id)
  }, [productions, activeProductionId, setActiveProduction, searchParams])

  // WebRTC only when multiviewer is enabled — passing null triggers clean disconnect
  useWebRTC(panels.multiviewer ? whepEndpoint : null)

  // WebSocket stays connected regardless of panel visibility (syncs tally + audio state)
  const send = useControllerWs(activeProductionId)

  const setElements = useAudioStore((s) => s.setElements)

  useEffect(() => {
    if (!activeProductionId) return
    setElements([], activeProductionId)
    if (activeProduction?.status !== 'active') return
    let cancelled = false
    void audioApi.discoverElements(activeProductionId).then((elements) => {
      if (!cancelled) setElements(elements, activeProductionId)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [activeProductionId, activeProduction?.status, setElements])

  const handleCut = useCallback(() => {
    cut()
    send({ type: 'CUT', mixerInput: pvwInput ?? '', afvRampMs: audioOptions.rampMs })
  }, [cut, send, pvwInput, audioOptions.rampMs])

  const handleAuto = useCallback(() => {
    auto()
    send({ type: 'TRANSITION', mixerInput: pvwInput ?? '', transitionType, durationMs: transitionDurationMs, afvRampMs: audioOptions.rampMs })
  }, [auto, send, pvwInput, transitionType, transitionDurationMs, audioOptions.rampMs])

  const handleFtb = useCallback(() => { ftb(); send({ type: 'FTB', durationMs: transitionDurationMs }) }, [ftb, send, transitionDurationMs])
  const handleSetOvl = useCallback((alpha: number) => { send({ type: 'SET_OVL', alpha }) }, [send])

  const handleSelectPvw = useCallback((mixerInput: string) => {
    setPvw(mixerInput)
    send({ type: 'SET_PVW', mixerInput })
  }, [setPvw, send])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.code === 'Space') { e.preventDefault(); handleCut() }
    if (e.code === 'Enter') { e.preventDefault(); handleAuto() }
  }, [handleCut, handleAuto])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(document.fullscreenElement === multiviewerRef.current)
      setIsPgmFullscreen(document.fullscreenElement === pgmRef.current)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const handleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void multiviewerRef.current?.requestFullscreen()
    }
  }, [])

  const handlePgmFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void pgmRef.current?.requestFullscreen()
    }
  }, [])

  const handleDskToggle = (layer: number, visible: boolean) => {
    send({ type: 'DSK_TOGGLE', layer, visible })
  }

  const handleMacroExec = (macroId: string) => {
    send({ type: 'MACRO_EXEC', macroId })
  }

  const PANEL_ICONS = [
    { key: 'multiviewer', Icon: MultiviewerIcon },
    { key: 'pgm',         Icon: MonitorIcon     },
    { key: 'controller',  Icon: ControllerIcon  },
    { key: 'audio',       Icon: AudioIcon        },
  ] as const

  const showBottomRow = panels.controller || panels.audio

  return (
    <>
    <div className="flex flex-col flex-1 min-h-0" style={{ background: '#000000' }}>
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white">
              {activeProduction?.name ?? 'Studio'}
            </span>
            {/* Panel toggle icons */}
            {PANEL_ICONS.map(({ key, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => togglePanel(key)}
                className={`cursor-pointer transition-colors ${panels[key] ? 'text-orange-500' : 'text-zinc-600'}`}
              >
                <Icon />
              </button>
            ))}
          </div>
        }
        actions={
          /* Timer bar + LIVE button — flush together, same height */
          <div className="flex items-stretch">
            <TimerBar />
            <div
              className={[
                'px-4 flex items-center text-[11px] font-bold uppercase tracking-widest border select-none',
                isOnAir
                  ? 'text-white border-red-600'
                  : 'text-zinc-500 bg-zinc-950 border-l-0 border-zinc-800',
              ].join(' ')}
              style={isOnAir ? { background: 'rgba(160,0,0,0.20)', borderColor: '#cc0000' } : {}}
            >
              <span className="flex items-center gap-1.5">
                <span style={isOnAir ? { color: '#ff2222' } : {}}>●</span>
                LIVE
              </span>
            </div>
          </div>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Video monitors row — Multiviewer + PGM side by side when both enabled.
            Each panel is a flex-col: label on top, video fills remaining height.
            flex-1 min-w-0 splits horizontal space so max-w-full on the videos
            prevents overflow regardless of how many panels are visible. */}
        {(panels.multiviewer || (panels.pgm && pgmWhepEndpoint)) && (
          <div className="flex-1 min-h-0 px-4 pt-2 pb-1 overflow-hidden flex flex-row items-stretch gap-6">

            {/* Multiviewer — unmounts fully when disabled, killing the WebRTC connection */}
            {panels.multiviewer && (
              <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-1.5" ref={multiviewerRef}>
                <div className="flex-none">
                  <SectionLabel
                    icon={<MultiviewerIcon />}
                    onPopOut={activeProductionId ? () => { window.open(`/pane/multiviewer?production=${activeProductionId}`, '_blank', 'noopener') } : undefined}
                    onHide={() => togglePanel('multiviewer')}
                    actions={
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const next = !multiviewerMuted
                            programPreviewRef.current?.setMuted(next)
                            setMultiviewerMuted(next)
                          }}
                          title={multiviewerMuted ? 'Unmute' : 'Mute'}
                          className="cursor-pointer hover:text-[--color-text-primary] transition-colors"
                        >
                          {multiviewerMuted ? <MutedIcon /> : <MuteIcon />}
                        </button>
                        <button
                          type="button"
                          onClick={handleFullscreen}
                          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                          className="cursor-pointer hover:text-[--color-text-primary] transition-colors"
                        >
                          {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
                        </button>
                      </>
                    }
                  >
                    Multiviewer
                  </SectionLabel>
                </div>
                <div className="flex-1 min-h-0 flex items-center justify-center">
                  <ProgramPreview ref={programPreviewRef} />
                </div>
              </div>
            )}

            {/* PGM — self-contained WebRTC, independent of multiviewer stream */}
            {panels.pgm && pgmWhepEndpoint && (
              <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-1.5" ref={pgmRef}>
                <div className="flex-none">
                  <SectionLabel
                    icon={<MonitorIcon />}
                    onPopOut={activeProductionId ? () => { window.open(`/pane/pgm?production=${activeProductionId}`, '_blank', 'noopener') } : undefined}
                    onHide={() => togglePanel('pgm')}
                    actions={
                      <>
                        <button
                          type="button"
                          onClick={() => setPgmMuted((m) => !m)}
                          title={pgmMuted ? 'Unmute PGM' : 'Mute PGM'}
                          className="cursor-pointer hover:text-[--color-text-primary] transition-colors"
                        >
                          {pgmMuted ? <MutedIcon /> : <MuteIcon />}
                        </button>
                        <button
                          type="button"
                          onClick={handlePgmFullscreen}
                          title={isPgmFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                          className="cursor-pointer hover:text-[--color-text-primary] transition-colors"
                        >
                          {isPgmFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
                        </button>
                      </>
                    }
                  >
                    PGM
                  </SectionLabel>
                </div>
                <div className="flex-1 min-h-0 flex items-center justify-center">
                  <PgmPreview whepEndpoint={pgmWhepEndpoint} muted={pgmMuted} />
                </div>
              </div>
            )}

          </div>
        )}

        {/* Controller + Audio row */}
        {showBottomRow && (
          <div className="flex flex-none pt-2 pb-3 gap-0">
            {panels.controller && (
              <div className={`px-3 flex flex-col gap-2 self-stretch ${panels.audio ? 'w-[70%]' : 'flex-1'}`}>
                <SectionLabel icon={<ControllerIcon />} onPopOut={activeProductionId ? () => { window.open(`/pane/controller?production=${activeProductionId}`, '_blank', 'noopener') } : undefined} onHide={() => togglePanel('controller')} actions={
                  <button type="button" onClick={() => setControllerOptionsOpen(true)} title="Controller options" className="cursor-pointer hover:text-[--color-text-primary] transition-colors"><GearIcon /></button>
                }>Controller</SectionLabel>
                <div className="flex flex-col flex-1 gap-2">
                  <TransitionPanel onCut={handleCut} onAuto={handleAuto} onFtb={handleFtb} onSelectPvw={handleSelectPvw} onSetOvl={handleSetOvl} className="flex-1" visibleTransitions={controllerOptions.visibleTransitions} />
                  <DskPanel onToggle={handleDskToggle} />
                  {false && activeProductionId && (
                    <MacroBar productionId={activeProductionId!} onExec={handleMacroExec} />
                  )}
                </div>
              </div>
            )}
            {panels.audio && (
              <div className={`flex flex-col gap-2 ${panels.controller ? 'w-[30%] pr-3' : 'flex-1 px-3'}`}>
                <SectionLabel icon={<AudioIcon />} onPopOut={activeProductionId ? () => { window.open(`/pane/audio?production=${activeProductionId}`, '_blank', 'noopener') } : undefined} onHide={() => togglePanel('audio')} actions={
                  <button type="button" onClick={() => setAudioOptionsOpen(true)} title="Audio options" className="cursor-pointer hover:text-[--color-text-primary] transition-colors"><GearIcon /></button>
                }>Audio</SectionLabel>
                <AudioPanel send={send} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {/* ── Audio options modal ──────────────────────────────────────────────── */}
    <Modal open={audioOptionsOpen} title="Audio Options" onClose={() => setAudioOptionsOpen(false)} className="max-w-xs">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <label className="text-xs text-[--color-text-muted] shrink-0">Ramp Time</label>
          <input
            type="number"
            min={0}
            max={5000}
            step={50}
            value={rampMsText}
            onChange={(e) => {
              setRampMsText(e.target.value)
              const parsed = parseInt(e.target.value, 10)
              if (!isNaN(parsed) && parsed >= 0 && parsed <= 5000) {
                const next = { ...audioOptions, rampMs: parsed }
                setAudioOptions(next)
                try { localStorage.setItem(AUDIO_OPTIONS_KEY, JSON.stringify(next)) } catch {}
              }
            }}
            onBlur={() => {
              const parsed = parseInt(rampMsText, 10)
              const clamped = isNaN(parsed) ? 200 : Math.max(0, Math.min(5000, parsed))
              setRampMsText(String(clamped))
              const next = { ...audioOptions, rampMs: clamped }
              setAudioOptions(next)
              try { localStorage.setItem(AUDIO_OPTIONS_KEY, JSON.stringify(next)) } catch {}
            }}
            className="bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[--color-accent] w-20"
          />
          <span className="text-xs text-[--color-text-muted] shrink-0">ms</span>
          <Tooltip title="Ramp Time" content={
            <span className="text-[11px] text-zinc-300 max-w-[200px] leading-relaxed">
              Crossfade ramp applied when audio follows a CUT or transition (default 200 ms). ON/OFF uses Strom's built-in anti-click ramp (~20 ms).
            </span>
          }>
            <span className="flex items-center justify-center w-4 h-4 rounded-full border border-zinc-600 text-zinc-500 hover:text-zinc-300 hover:border-zinc-400 transition-colors cursor-default text-[10px] font-bold leading-none shrink-0">i</span>
          </Tooltip>
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
            const checked = controllerOptions.visibleTransitions.includes(t)
            const isLast  = controllerOptions.visibleTransitions.length === 1 && checked
            return (
              <label key={t} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isLast}
                  onChange={() => {
                    const next = checked
                      ? controllerOptions.visibleTransitions.filter((x) => x !== t)
                      : [...controllerOptions.visibleTransitions, t]
                    const opts = { ...controllerOptions, visibleTransitions: next }
                    setControllerOptions(opts)
                    try { localStorage.setItem(CONTROLLER_OPTIONS_KEY, JSON.stringify(opts)) } catch {}
                  }}
                  className="accent-orange-500"
                />
                <span className="text-sm text-[--color-text-primary] text-[11px]">{TRANSITION_LABELS[t] ?? t}</span>
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
