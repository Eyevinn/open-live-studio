import { useEffect, useCallback, useRef } from 'react'
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
import { ProgramPreview } from '@/pages/ControllerPage/ProgramPreview'
import { TransitionPanel } from '@/pages/ControllerPage/TransitionPanel'
import { DskPanel } from '@/pages/ControllerPage/DskPanel'
import { AudioPanel } from '@/pages/ControllerPage/AudioPanel'
import { Badge } from '@/components/ui/Badge'

type Pane = 'multiviewer' | 'controller' | 'audio' | 'pgm'

// ─── PGM confidence monitor ───────────────────────────────────────────────────

function PgmPane() {
  const { programStream, connectionState, retryCountdown } = useViewerStore()
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = programStream ?? null
    }
  }, [programStream])

  const isConnected = connectionState === 'connected'

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center bg-black p-4">
      <div
        className="relative h-full max-h-full aspect-video"
        style={{ boxShadow: isConnected ? '0 0 0 2px #dc2626' : '0 0 0 2px #3f3f46' }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-contain bg-black"
        />
        {/* PROGRAM label — bottom left */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 pointer-events-none">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-red-600' : 'bg-zinc-600'}`} />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white opacity-80">Program</span>
        </div>
        {/* Connection state badge — bottom right */}
        <div className="absolute bottom-3 right-3 pointer-events-none">
          {connectionState === 'connected' && <Badge variant="live" label="LIVE" />}
          {connectionState === 'connecting' && <Badge variant="connecting" label="CONNECTING" />}
          {connectionState === 'error' && (
            <Badge variant="error" label={retryCountdown != null ? `RETRYING IN ${retryCountdown}` : 'ERROR'} />
          )}
        </div>
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

  useEffect(() => {
    if (productionId) setActiveProduction(productionId)
  }, [productionId, setActiveProduction])

  useWebRTC(
    pane === 'multiviewer' ? (whepEndpoint ?? null) :
    pane === 'pgm'         ? (pgmWhepEndpoint ?? null) :
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
    <div className="h-screen w-screen bg-[--color-surface-1] overflow-hidden flex flex-col">
      {pane === 'multiviewer' && (
        <div className="flex-1 min-h-0 flex items-center justify-center p-2">
          <ProgramPreview />
        </div>
      )}
      {pane === 'controller' && (
        <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
          <TransitionPanel
            onCut={handleCut}
            onAuto={handleAuto}
            onFtb={handleFtb}
            onSelectPvw={handleSelectPvw}
            onSetOvl={handleSetOvl}
          />
          <DskPanel onToggle={handleDskToggle} />
        </div>
      )}
      {pane === 'audio' && (
        <div className="flex-1 overflow-auto p-4">
          <AudioPanel send={send} />
        </div>
      )}
      {pane === 'pgm' && <PgmPane />}
    </div>
  )
}
