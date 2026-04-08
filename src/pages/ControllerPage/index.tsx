import { useEffect, useCallback } from 'react'
import { useWebRTC } from '@/hooks/useWebRTC'
import { useControllerWs } from '@/hooks/useControllerWs'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ProgramPreview } from './ProgramPreview'
import { TransitionPanel } from './TransitionPanel'
import { GraphicsPanel } from './GraphicsPanel'
import { StreamDeckSurface } from './StreamDeckSurface'
import { DskPanel } from './DskPanel'
import { MacroBar } from './MacroBar'
import { TimerBar } from './TimerBar'
import { StreamingStatus } from './StreamingStatus'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useStatsStore } from '@/store/stats.store'

export function ControllerPage() {
  const { isLive, setLive, cut, take, activeProductionId } = useProductionStore()
  const whepEndpoint = useProductionsStore(
    (s) => s.productions.find((p) => p.id === activeProductionId)?.whepEndpoint,
  )
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

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.code === 'Space') { e.preventDefault(); cut() }
    if (e.code === 'Enter') { e.preventDefault(); take() }
  }, [cut, take])

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
        title="Controller"
        subtitle="Space = Cut  ·  Enter = Take"
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

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {/* Multiviewer — full-width WHEP player */}
        <ProgramPreview />

        {/* Controls — full width */}
        <TransitionPanel />
        <DskPanel onToggle={handleDskToggle} />

        {activeProductionId && (
          <MacroBar productionId={activeProductionId} onExec={handleMacroExec} />
        )}

        <GraphicsPanel />
        <StreamDeckSurface />
      </div>
    </div>
  )
}
