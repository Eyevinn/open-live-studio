import { useEffect, useRef, useState } from 'react'
import { useViewerStore } from '@/store/viewer.store'
import { WhepClient } from '@/lib/webrtc'
import { getApiToken } from '@/lib/sat'

const API_BASE =
  (typeof window !== 'undefined' && (window as unknown as { _env_?: { OPEN_LIVE_URL?: string } })._env_?.OPEN_LIVE_URL) ||
  import.meta.env.OPEN_LIVE_URL ||
  ''

/**
 * Manages the program stream for the controller's PGM monitor.
 *
 * - With a whepEndpoint: establishes a real WHEP connection to Strom.
 * - Without one: shows offline state — never touches the camera.
 *
 * Reconnects automatically when whepEndpoint changes.
 * See docs/repo-patterns.md: "WebRTC viewer fails on mobile without TURN"
 * See docs/repo-patterns.md: "Safari requires playsinline autoplay muted"
 */
export function useWebRTC(whepEndpoint?: string | null): void {
  const setProgramStream = useViewerStore((s) => s.setProgramStream)
  const setConnectionState = useViewerStore((s) => s.setConnectionState)
  const disconnect = useViewerStore((s) => s.disconnect)
  const clientRef = useRef<WhepClient | null>(null)
  const [authToken, setAuthToken] = useState<string | undefined>(undefined)

  useEffect(() => {
    getApiToken().then(setAuthToken).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false

    if (whepEndpoint) {
      setConnectionState('connecting')
      const client = new WhepClient(whepEndpoint, {
        onVideoTrack: (stream) => {
          if (!cancelled) setProgramStream(stream, false)
        },
        onConnected: () => {
          if (!cancelled) setConnectionState('connected')
        },
        onDisconnected: () => {
          if (!cancelled) setConnectionState('disconnected')
        },
        onError: () => {
          if (!cancelled) setConnectionState('error')
        },
      }, { iceServersUrl: `${API_BASE}/api/v1/ice-servers`, proxyUrl: `${API_BASE}/api/v1/whep-proxy`, authToken })
      clientRef.current = client
      void client.connect()
    } else {
      disconnect()
    }

    return () => {
      cancelled = true
      if (clientRef.current) {
        void clientRef.current.disconnect()
        clientRef.current = null
      } else {
        disconnect()
      }
    }
  }, [whepEndpoint, authToken, setProgramStream, setConnectionState, disconnect])
}
