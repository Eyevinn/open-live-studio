import { useEffect } from 'react'
import { authenticateWithOpenLive } from '@/lib/sat'

const REFRESH_BUFFER_MS = 5 * 60 * 1000

export function useOscAuth(): void {
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>

    async function authenticate() {
      const expiresAt = await authenticateWithOpenLive()
      if (expiresAt === 0) return
      const delay = Math.max(expiresAt - Date.now() - REFRESH_BUFFER_MS, 60_000)
      timeoutId = setTimeout(() => { void authenticate() }, delay)
    }

    void authenticate()
    return () => clearTimeout(timeoutId)
  }, [])
}
