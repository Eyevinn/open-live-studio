import { useEffect, useState } from 'react'
import { serverInfoApi, type ServerInfo } from '@/lib/api'

/**
 * The backend's server-info, fetched once per page load and shared by every
 * caller. It changes only when the backend restarts or its port lease moves,
 * neither of which needs a live view here. `loaded` separates "still fetching"
 * from "fetched, and the backend has no such route".
 */
let cached: Promise<ServerInfo | null> | null = null

function load(): Promise<ServerInfo | null> {
  cached ??= serverInfoApi.get().catch(() => null)
  return cached
}

export function useServerInfo(): { info: ServerInfo | null; loaded: boolean } {
  const [state, setState] = useState<{ info: ServerInfo | null; loaded: boolean }>({ info: null, loaded: false })
  useEffect(() => {
    let live = true
    void load().then((info) => { if (live) setState({ info, loaded: true }) })
    return () => { live = false }
  }, [])
  return state
}
