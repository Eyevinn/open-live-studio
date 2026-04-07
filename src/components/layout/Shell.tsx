import { Outlet } from 'react-router'
import { NavBar } from './NavBar'
import { useSourcePolling } from '@/hooks/useSourcePolling'
import { useStreamDeck } from '@/hooks/useStreamDeck'
import { useProductionStore } from '@/store/production.store'
import { cn } from '@/lib/cn'

function LiveClock() {
  return (
    <span className="font-mono text-xs text-[--color-text-muted]">
      {new Date().toLocaleTimeString('en-GB', { hour12: false })}
    </span>
  )
}

export function Shell() {
  useSourcePolling()
  useStreamDeck()

  const isLive = useProductionStore((s) => s.isLive)
  const activeProductionId = useProductionStore((s) => s.activeProductionId)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[--color-surface-1]">
      <NavBar />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-12 flex items-center justify-between px-4 border-b border-[--color-border] bg-[--color-surface-2] flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[--color-text-primary] text-sm font-semibold tracking-wide">Open Live</span>
            {activeProductionId && (
              <span className="text-[--color-text-muted] text-xs">{activeProductionId}</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <LiveClock />
            {isLive && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[--color-live] animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                <span className="text-white text-xs font-bold font-mono">ON AIR</span>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className={cn('flex-1 overflow-auto')}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
