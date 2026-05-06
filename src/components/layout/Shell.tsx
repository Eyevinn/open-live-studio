import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { NavBar } from './NavBar'
import { useTemplatesStore } from '@/store/templates.store'
import { useOscAuth } from '@/hooks/useOscAuth'

export function Shell() {
  const fetchTemplates = useTemplatesStore((s) => s.fetchAll)
  useOscAuth()

  useEffect(() => { void fetchTemplates() }, [fetchTemplates])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[--color-surface-1]">
      <NavBar />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
