import { useEffect, useCallback } from 'react'
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
import { audioApi } from '@/lib/api'
import { ProgramPreview } from '@/pages/ControllerPage/ProgramPreview'
import { TransitionPanel } from '@/pages/ControllerPage/TransitionPanel'
import { DskPanel } from '@/pages/ControllerPage/DskPanel'
import { AudioPanel } from '@/pages/ControllerPage/AudioPanel'

type Pane = 'multiviewer' | 'controller' | 'audio'

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
  const activeProduction = useProductionsStore((s) => s.productions.find((p) => p.id === productionId))
  const whepEndpoint     = useProductionsStore((s) => s.productions.find((p) => p.id === productionId)?.whepEndpoint)

  useEffect(() => {
    if (productionId) setActiveProduction(productionId)
  }, [productionId, setActiveProduction])

  useWebRTC(pane === 'multiviewer' ? whepEndpoint : null)
  const send = useControllerWs(pane !== 'multiviewer' ? productionId : null)

  const setElements = useAudioStore((s) => s.setElements)
  useEffect(() => {
    if (!productionId || activeProduction?.status !== 'active') return
    void audioApi.discoverElements(productionId).then((elements) => {
      if (elements.length > 0) setElements(elements, productionId)
    }).catch(() => {})
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
    </div>
  )
}
