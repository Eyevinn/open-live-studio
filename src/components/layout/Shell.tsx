import { Outlet } from 'react-router'
import { NavBar } from './NavBar'
import { useOscAuth } from '@/hooks/useOscAuth'
import { useConnectionCheck } from '@/hooks/useConnectionCheck'
import { ToastContainer } from '@/components/ui/ToastContainer'

export function Shell() {
  useOscAuth()
  useConnectionCheck()

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[--color-surface-1]">
      <NavBar />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <Outlet />
        </main>
      </div>

      <ToastContainer />
    </div>
  )
}
