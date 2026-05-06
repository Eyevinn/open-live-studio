import { useEffect, useRef } from 'react'
import { useViewerStore } from '@/store/viewer.store'
import { WhepClient } from '@/lib/webrtc'
import { getApiToken } from '@/lib/sat'

import { BASE as API_BASE } from '@/lib/base'

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
  const setRetryCountdown = useViewerStore((s) => s.setRetryCountdown)
  const disconnect = useViewerStore((s) => s.disconnect)
  const clientRef = useRef<WhepClient | null>(null)

  useEffect(() => {
    if (!whepEndpoint) {
      disconnect()
      return
    }

    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let countdownTimer: ReturnType<typeof setInterval> | null = null

    const startCountdown = (seconds: number, onDone: () => void) => {
      setRetryCountdown(seconds)
      let remaining = seconds - 1
      countdownTimer = setInterval(() => {
        if (cancelled) { clearInterval(countdownTimer!); return }
        if (remaining <= 0) {
          clearInterval(countdownTimer!)
          setRetryCountdown(null)
          onDone()
        } else {
          setRetryCountdown(remaining--)
        }
      }, 1000)
    }

    // authToken is resolved once per endpoint mount — not reactive state,
    // so token resolution never triggers a second connect cycle.
    let authToken: string | undefined

    const connect = () => {
      if (cancelled) return
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
          if (!cancelled) {
            setConnectionState('error')
            startCountdown(3, connect)
          }
        },
      }, { iceServersUrl: `${API_BASE}/api/v1/ice-servers`, proxyUrl: `${API_BASE}/api/v1/whep-proxy`, authToken })
      clientRef.current = client
      void client.connect()
    }

    // Fetch token once, then connect. Retries reuse the same token variable.
    getApiToken()
      .catch(() => undefined)
      .then((token) => {
        if (cancelled) return
        authToken = token
        connect()
      })

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (countdownTimer) clearInterval(countdownTimer)
      setRetryCountdown(null)
      if (clientRef.current) {
        void clientRef.current.disconnect()
        clientRef.current = null
      } else {
        disconnect()
      }
    }
  }, [whepEndpoint, setProgramStream, setConnectionState, setRetryCountdown, disconnect])
}
