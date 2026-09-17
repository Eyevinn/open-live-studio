import { Outlet } from 'react-router'
import { NavBar } from './NavBar'
import { useOscAuth } from '@/hooks/useOscAuth'
import { useConnectionCheck } from '@/hooks/useConnectionCheck'
import { useSessionKeepAlive } from '@/hooks/useSessionKeepAlive'
import { ToastContainer } from '@/components/ui/ToastContainer'

export function Shell() {
  useOscAuth()
  useConnectionCheck()
  // Hold a controller keep-alive for the selected production while any Studio
  // view is open — Productions list and I/O setup included — not only while the
  // mixer view is mounted, so routine operator navigation never re-arms the
  // backend idle auto-deactivate (#139).
  useSessionKeepAlive()

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 bg-[--color-surface-1]">
      <NavBar />

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <Outlet />
        </main>
      </div>

      <ToastContainer />
    </div>
  )
}
