import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { NavBar } from './NavBar'
import { useStreamDeck } from '@/hooks/useStreamDeck'
import { useProductionStore } from '@/store/production.store'
import { useSourcesStore } from '@/store/sources.store'
import { useProductionsStore } from '@/store/productions.store'

function LiveClock() {
  return (
    <span className="font-mono text-xs text-[--color-text-muted]">
      {new Date().toLocaleTimeString('en-GB', { hour12: false })}
    </span>
  )
}

export function Shell() {
  useStreamDeck()
  const fetchSources = useSourcesStore((s) => s.fetchAll)
  const fetchProductions = useProductionsStore((s) => s.fetchAll)

  useEffect(() => {
    void fetchSources()
    void fetchProductions()
    const id = setInterval(() => {
      void fetchSources()
      void fetchProductions()
    }, 5000)
    return () => clearInterval(id)
  }, [fetchSources, fetchProductions])

  const isLive = useProductionStore((s) => s.isLive)
  const activeProductionId = useProductionStore((s) => s.activeProductionId)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[--color-surface-1]">
      <NavBar />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header — same bg as page so it blends in */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-[--color-border] bg-[--color-surface-2] flex-shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-[--color-text-primary] text-base font-bold tracking-wide">Open Live</span>
            {activeProductionId && (
              <span className="text-[--color-text-muted] text-sm">{activeProductionId}</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <LiveClock />
            {isLive && (
              <div className="flex items-center gap-2 px-3 py-1 rounded bg-[--color-live] animate-pulse">
                <span className="w-2 h-2 rounded-full bg-white" />
                <span className="text-white text-xs font-bold font-mono tracking-widest">ON AIR</span>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
