import { useEffect, useState } from 'react'
import { serverInfoApi, type ServerInfo } from '@/lib/api'

/**
 * The backend's server-info, fetched once per page load and shared by every
 * caller. It changes only when the backend restarts or its port lease moves,
 * neither of which needs a live view here.
 */
let cached: Promise<ServerInfo | null> | null = null

function load(): Promise<ServerInfo | null> {
  cached ??= serverInfoApi.get().catch(() => null)
  return cached
}

export function useServerInfo(): ServerInfo | null {
  const [info, setInfo] = useState<ServerInfo | null>(null)
  useEffect(() => {
    let live = true
    void load().then((i) => { if (live) setInfo(i) })
    return () => { live = false }
  }, [])
  return info
}
