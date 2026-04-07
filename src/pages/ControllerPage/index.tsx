import { useEffect, useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWebRTC } from '@/hooks/useWebRTC'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { MultiviewCell } from '@/components/ui/MultiviewCell'
import { ProgramPreview } from './ProgramPreview'
import { SourceBus } from './SourceBus'
import { TransitionPanel } from './TransitionPanel'
import { GraphicsPanel } from './GraphicsPanel'
import { StreamDeckSurface } from './StreamDeckSurface'
import { useProductionStore } from '@/store/production.store'
import { useSourcesStore } from '@/store/sources.store'
import { cn } from '@/lib/cn'

type GridSize = '2x2' | '3x3' | '4x4'
const GRID_COLS: Record<GridSize, number> = { '2x2': 2, '3x3': 3, '4x4': 4 }
const GRID_MAX: Record<GridSize, number>  = { '2x2': 4, '3x3': 9, '4x4': 16 }
const LS_KEY = 'openlive:multiviewer-grid'

export function ControllerPage() {
  useWebRTC()

  const { isLive, setLive, cut, take } = useProductionStore()

  const [gridSize, setGridSize] = useState<GridSize>(() =>
    (localStorage.getItem(LS_KEY) as GridSize | null) ?? '2x2'
  )

  useEffect(() => { localStorage.setItem(LS_KEY, gridSize) }, [gridSize])

  const sources = useSourcesStore(useShallow((s) =>
    s.sources.filter((src) => src.status !== 'disconnected').slice(0, GRID_MAX[gridSize])
  ))

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.code === 'Space') { e.preventDefault(); cut() }
    if (e.code === 'Enter') { e.preventDefault(); take() }
  }, [cut, take])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const cols = GRID_COLS[gridSize]
  const maxCells = GRID_MAX[gridSize]
  const emptyCells = Math.max(0, maxCells - sources.length)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Controller"
        subtitle="Space = Cut  ·  Enter = Take"
        actions={
          <Button
            variant={isLive ? 'pgm' : 'default'}
            size="md"
            onClick={() => setLive(!isLive)}
          >
            {isLive ? '● ON AIR' : '○ Go Live'}
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {/* PGM / PVW monitors */}
        <ProgramPreview />

        {/* Multiviewer */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[--color-text-muted]">Multiviewer</span>
            <div className="flex gap-1">
              {(['2x2', '3x3', '4x4'] as GridSize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => setGridSize(size)}
                  className={cn(
                    'px-2 py-0.5 rounded text-[10px] font-mono uppercase transition-colors',
                    gridSize === size
                      ? 'bg-[--color-accent] text-[#1a1a1a]'
                      : 'bg-[--color-surface-3] text-[--color-text-muted] hover:text-[--color-text-primary]',
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-black p-px rounded overflow-hidden">
            <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {sources.map((src) => (
                <MultiviewCell key={src.id} source={src} />
              ))}
              {Array.from({ length: emptyCells }, (_, i) => (
                <div key={`empty-${i}`} className="aspect-video bg-zinc-950 flex items-center justify-center">
                  <span className="text-zinc-700 text-[10px] font-mono uppercase tracking-widest">No Source</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Source bus */}
        <SourceBus />

        {/* Transition + Graphics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TransitionPanel />
          <GraphicsPanel />
        </div>

        {/* Stream Deck */}
        <StreamDeckSurface />
      </div>
    </div>
  )
}
