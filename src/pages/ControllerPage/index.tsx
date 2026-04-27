import { useEffect, useCallback, useState, useRef, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useWebRTC } from '@/hooks/useWebRTC'
import { useControllerWs } from '@/hooks/useControllerWs'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ProgramPreview, type ProgramPreviewHandle } from './ProgramPreview'
import { TransitionPanel } from './TransitionPanel'
import { DskPanel } from './DskPanel'
import { MacroBar } from './MacroBar'
import { AudioPanel } from './AudioPanel'
import { TimerBar } from './TimerBar'
import { StreamingStatus } from './StreamingStatus'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useStatsStore } from '@/store/stats.store'
import { useAudioStore } from '@/store/audio.store'
import { audioApi } from '@/lib/api'

// ─── Panel layout persistence ─────────────────────────────────────────────────

const PANELS_STORAGE_KEY = 'ol-studio-panels'

type Panels = { multiviewer: boolean; controller: boolean; audio: boolean }

function loadPanels(): Panels {
  try {
    const raw = localStorage.getItem(PANELS_STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Panels>
      return {
        multiviewer: p.multiviewer !== false,
        controller:  p.controller  !== false,
        audio:       p.audio       !== false,
      }
    }
  } catch {}
  return { multiviewer: true, controller: true, audio: true }
}

function savePanels(panels: Panels) {
  try { localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(panels)) } catch {}
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function PopOutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 2H2v12h12V9" />
      <path d="M10 2h4v4" />
      <line x1="14" y1="2" x2="7" y2="9" />
    </svg>
  )
}

function SectionLabel({ icon, children, onPopOut, actions }: { icon: ReactNode; children: string; onPopOut?: () => void; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[--color-text-muted]">
      {icon}
      <span className="text-[10px] font-semibold uppercase tracking-widest">{children}</span>
      {onPopOut && (
        <button
          type="button"
          onClick={onPopOut}
          title={`Pop out ${children}`}
          className="ml-0.5 cursor-pointer hover:text-[--color-text-primary] transition-colors"
        >
          <PopOutIcon />
        </button>
      )}
      {actions}
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
  const { isLive, setLive, cut, auto, ftb, setPvw, pvwInput, transitionType, transitionDurationMs, activeProductionId, setActiveProduction } = useProductionStore()
  const productions = useProductionsStore((s) => s.productions)
  const activeProduction = useProductionsStore((s) => s.productions.find((p) => p.id === activeProductionId))
  const whepEndpoint = useProductionsStore(
    (s) => s.productions.find((p) => p.id === activeProductionId)?.whepEndpoint,
  )
  const [searchParams] = useSearchParams()
  const [panels, setPanels] = useState<Panels>(loadPanels)
  const [multiviewerMuted, setMultiviewerMuted] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const multiviewerRef = useRef<HTMLDivElement>(null)
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

  const startPolling = useStatsStore((s) => s.startPolling)
  const stopPolling  = useStatsStore((s) => s.stopPolling)

  useEffect(() => {
    if (activeProductionId) {
      startPolling(activeProductionId)
    } else {
      stopPolling()
    }
    return () => stopPolling()
  }, [activeProductionId, startPolling, stopPolling])

  const setElements = useAudioStore((s) => s.setElements)

  useEffect(() => {
    if (!activeProductionId || activeProduction?.status !== 'active') return
    void audioApi.discoverElements(activeProductionId).then((elements) => {
      if (elements.length > 0) setElements(elements, activeProductionId)
    }).catch(() => {})
  }, [activeProductionId, activeProduction?.status, setElements])

  const handleCut = useCallback(() => {
    cut()
    send({ type: 'CUT', mixerInput: pvwInput ?? '' })
  }, [cut, send, pvwInput])

  const handleAuto = useCallback(() => {
    auto()
    send({ type: 'TRANSITION', mixerInput: pvwInput ?? '', transitionType, durationMs: transitionDurationMs })
  }, [auto, send, pvwInput, transitionType, transitionDurationMs])

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
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
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

  const handleGoLive = () => {
    const next = !isLive
    setLive(next)
    send(next ? { type: 'GO_LIVE' } : { type: 'CUT_STREAM' })
  }

  const handleDskToggle = (layer: number, visible: boolean) => {
    send({ type: 'DSK_TOGGLE', layer, visible })
  }

  const handleMacroExec = (macroId: string) => {
    send({ type: 'MACRO_EXEC', macroId })
  }

  const PANEL_ICONS = [
    { key: 'multiviewer', Icon: MultiviewerIcon },
    { key: 'controller',  Icon: ControllerIcon  },
    { key: 'audio',       Icon: AudioIcon        },
  ] as const

  const showBottomRow = panels.controller || panels.audio

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={
          <div className="flex items-center gap-4">
            <span>{activeProduction?.name ?? 'Studio'}</span>
            {PANEL_ICONS.map(({ key, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => togglePanel(key)}
                className={`cursor-pointer transition-colors ${panels[key] ? 'text-green-600' : 'text-red-600'}`}
              >
                <Icon />
              </button>
            ))}
          </div>
        }
        actions={
          <div className="flex items-center gap-4">
            <TimerBar />
            <StreamingStatus />
            <Button
              variant={isLive ? 'pgm' : 'default'}
              size="md"
              onClick={handleGoLive}
              disabled={activeProduction?.status === 'activating'}
            >
              {activeProduction?.status === 'activating' ? '◌ Starting...' : isLive ? '● ON AIR' : '○ Go Live'}
            </Button>
          </div>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Multiviewer — unmounts fully when disabled, killing the WebRTC connection */}
        {panels.multiviewer && (
          <div className="flex-1 min-h-0 px-4 pt-9 overflow-hidden flex items-center justify-center">
            {/* h-full wrapper takes the same height as the video so the absolute label anchors to the video's left edge */}
            <div className="relative h-full" ref={multiviewerRef}>
              <div className="absolute -top-6 left-0">
                <SectionLabel
                  icon={<MultiviewerIcon />}
                  onPopOut={activeProductionId ? () => { window.open(`/pane/multiviewer?production=${activeProductionId}`, '_blank', 'noopener'); togglePanel('multiviewer') } : undefined}
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
              <ProgramPreview ref={programPreviewRef} />
            </div>
          </div>
        )}

        {/* Controller + Audio row */}
        {showBottomRow && (
          <div className={`flex pt-3 pb-4 ${panels.multiviewer ? 'flex-none' : 'flex-1 min-h-0 overflow-auto'}`}>
            {panels.controller && (
              <div className={`px-4 flex flex-col gap-3 ${panels.audio ? 'w-[70%]' : 'flex-1'}`}>
                <SectionLabel icon={<ControllerIcon />} onPopOut={activeProductionId ? () => { window.open(`/pane/controller?production=${activeProductionId}`, '_blank', 'noopener'); togglePanel('controller') } : undefined}>Controller</SectionLabel>
                <TransitionPanel onCut={handleCut} onAuto={handleAuto} onFtb={handleFtb} onSelectPvw={handleSelectPvw} onSetOvl={handleSetOvl} />
                <DskPanel onToggle={handleDskToggle} />
                {false && activeProductionId && (
                  <MacroBar productionId={activeProductionId!} onExec={handleMacroExec} />
                )}
              </div>
            )}
            {panels.audio && (
              <div className={`flex flex-col gap-3 ${panels.controller ? 'w-[30%] pr-4' : 'flex-1 px-4'}`}>
                <div className="ml-4">
                  <SectionLabel icon={<AudioIcon />} onPopOut={activeProductionId ? () => { window.open(`/pane/audio?production=${activeProductionId}`, '_blank', 'noopener'); togglePanel('audio') } : undefined}>Audio</SectionLabel>
                </div>
                <AudioPanel send={send} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
