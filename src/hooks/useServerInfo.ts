import { useSyncExternalStore } from 'react'
import { serverInfoApi, type ServerInfo } from '@/lib/api'

/**
 * The backend's server-info, shared by every caller. It is fetched once when
 * the first caller mounts, and again on `refreshServerInfo()`: `srt` carries
 * live Strom state (`unknown` until the backend's first capabilities check,
 * `unreachable` while Strom is down), so the source and output dialogs refetch
 * it when they open. `loaded` separates "still fetching" from "fetched, and
 * the backend has no such route".
 */
type ServerInfoState = { info: ServerInfo | null; loaded: boolean }

let current: ServerInfoState = { info: null, loaded: false }
let inflight: Promise<void> | null = null
let started = false
const listeners = new Set<() => void>()

function fetchInfo(): Promise<void> {
  inflight ??= serverInfoApi.get()
    // A failed refetch keeps what was last read; a failed first fetch reads
    // as an older backend without the route.
    .catch(() => (current.loaded ? current.info : null))
    .then((info) => {
      inflight = null
      current = { info, loaded: true }
      for (const listener of listeners) listener()
    })
  return inflight
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!started) {
    started = true
    void fetchInfo()
  }
  return () => { listeners.delete(listener) }
}

const snapshot = () => current

/** Fetch server-info again; every `useServerInfo` caller gets the answer. */
export function refreshServerInfo(): Promise<void> {
  started = true
  return fetchInfo()
}

export function useServerInfo(): ServerInfoState {
  return useSyncExternalStore(subscribe, snapshot)
}
