import { useEffect, useCallback } from 'react'
import { useWebRTC } from '@/hooks/useWebRTC'
import { useControllerWs } from '@/hooks/useControllerWs'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ProgramPreview } from './ProgramPreview'
import { TransitionPanel } from './TransitionPanel'
import { GraphicsPanel } from './GraphicsPanel'
import { DskPanel } from './DskPanel'
import { MacroBar } from './MacroBar'
import { TimerBar } from './TimerBar'
import { StreamingStatus } from './StreamingStatus'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useStatsStore } from '@/store/stats.store'

export function ControllerPage() {
  const { isLive, setLive, cut, auto, ftb, setPvw, pvwSourceId, transitionType, transitionDurationMs, activeProductionId, setActiveProduction } = useProductionStore()
  const productions = useProductionsStore((s) => s.productions)
  const whepEndpoint = useProductionsStore(
    (s) => s.productions.find((p) => p.id === activeProductionId)?.whepEndpoint,
  )

  useEffect(() => {
    if (activeProductionId) return
    const active = [...productions].reverse().find((p) => p.status === 'active')
    if (active) setActiveProduction(active.id)
  }, [productions, activeProductionId, setActiveProduction])
  useWebRTC(whepEndpoint)
  const send = useControllerWs(activeProductionId)
  const startPolling = useStatsStore((s) => s.startPolling)
  const stopPolling = useStatsStore((s) => s.stopPolling)

  useEffect(() => {
    if (activeProductionId) {
      startPolling(activeProductionId)
    } else {
      stopPolling()
    }
    return () => stopPolling()
  }, [activeProductionId, startPolling, stopPolling])

  const handleCut = useCallback(() => {
    cut()
    send({ type: 'CUT', sourceId: pvwSourceId ?? '' })
  }, [cut, send, pvwSourceId])

  const handleAuto = useCallback(() => {
    auto()
    send({ type: 'TRANSITION', sourceId: pvwSourceId ?? '', transitionType, durationMs: transitionDurationMs })
  }, [auto, send, pvwSourceId, transitionType, transitionDurationMs])

  const handleFtb = useCallback(() => { ftb(); send({ type: 'FTB', durationMs: transitionDurationMs }) }, [ftb, send, transitionDurationMs])
  const handleSetOvl = useCallback((alpha: number) => { send({ type: 'SET_OVL', alpha }) }, [send])

  const handleSelectPvw = useCallback((sourceId: string) => {
    setPvw(sourceId)
    send({ type: 'SET_PVW', sourceId })
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

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={
          <div className="relative inline-flex items-center">
            <select
              value={activeProductionId ?? ''}
              onChange={(e) => setActiveProduction(e.target.value || null)}
              className="h-9 appearance-none rounded-md border border-[--color-border] bg-[--color-surface] pl-3 pr-8 text-sm font-bold text-[--color-text-primary] focus:outline-none focus:ring-2 focus:ring-[--color-accent]"
            >
              <option value="">— No production —</option>
              {productions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.status === 'active' ? ' ●' : p.status === 'activating' ? ' ◌' : ''}
                </option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-2 w-3.5 h-3.5 text-[--color-text-muted]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
            >
              {isLive ? '● ON AIR' : '○ Go Live'}
            </Button>
          </div>
        }
      />

      {/* Player above, controls below — full scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 pt-4">
          <ProgramPreview />
        </div>
        <div className="px-4 pb-4 pt-3 flex flex-col gap-3">
          <TransitionPanel onCut={handleCut} onAuto={handleAuto} onFtb={handleFtb} onSelectPvw={handleSelectPvw} onSetOvl={handleSetOvl} />
          {activeProductionId && (
            <MacroBar productionId={activeProductionId} onExec={handleMacroExec} />
          )}
          <DskPanel onToggle={handleDskToggle} />
          <GraphicsPanel />
        </div>
      </div>
    </div>
  )
}
