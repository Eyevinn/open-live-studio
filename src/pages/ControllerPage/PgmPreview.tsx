import { useEffect, useRef, useState } from 'react'
import { WhepClient } from '@/lib/webrtc'
import { getApiToken } from '@/lib/sat'
import { Badge } from '@/components/ui/Badge'
import type { ViewerConnectionState } from '@/store/viewer.store'

const API_BASE =
  (typeof window !== 'undefined' && (window as unknown as { _env_?: { OPEN_LIVE_URL?: string } })._env_?.OPEN_LIVE_URL) ||
  import.meta.env.OPEN_LIVE_URL ||
  ''

interface PgmPreviewProps {
  whepEndpoint: string
}

/**
 * Self-contained PGM program monitor. Establishes its own WHEP connection
 * independently of the multiviewer — does NOT use the shared viewer store,
 * so the two streams can coexist in the same page without conflicting.
 */
export function PgmPreview({ whepEndpoint }: PgmPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [connectionState, setConnectionState] = useState<ViewerConnectionState>('disconnected')
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null)
  const clientRef = useRef<WhepClient | null>(null)

  useEffect(() => {
    let cancelled = false
    let countdownTimer: ReturnType<typeof setInterval> | null = null
    let authToken: string | undefined

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

    const connect = () => {
      if (cancelled) return
      setConnectionState('connecting')
      const client = new WhepClient(
        whepEndpoint,
        {
          onVideoTrack: (stream) => {
            if (!cancelled && videoRef.current) videoRef.current.srcObject = stream
          },
          onConnected:    () => { if (!cancelled) setConnectionState('connected') },
          onDisconnected: () => { if (!cancelled) setConnectionState('disconnected') },
          onError:        () => {
            if (!cancelled) {
              setConnectionState('error')
              startCountdown(3, connect)
            }
          },
        },
        { iceServersUrl: `${API_BASE}/api/v1/ice-servers`, proxyUrl: `${API_BASE}/api/v1/whep-proxy`, authToken },
      )
      clientRef.current = client
      void client.connect()
    }

    getApiToken()
      .catch(() => undefined)
      .then((token) => {
        if (cancelled) return
        authToken = token
        connect()
      })

    return () => {
      cancelled = true
      if (countdownTimer) clearInterval(countdownTimer)
      setRetryCountdown(null)
      if (clientRef.current) {
        void clientRef.current.disconnect()
        clientRef.current = null
      }
      if (videoRef.current) videoRef.current.srcObject = null
      setConnectionState('disconnected')
    }
  }, [whepEndpoint])

  return (
    <div className="relative h-full aspect-video max-w-full border border-zinc-800" style={{ background: '#000' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="h-full w-full object-contain"
      />
      <div className="absolute bottom-2 right-2 pointer-events-none">
        {connectionState === 'connected'  && <Badge variant="live"       label="LIVE" />}
        {connectionState === 'connecting' && <Badge variant="connecting" label="CONNECTING" />}
        {connectionState === 'error'      && (
          <Badge variant="error" label={retryCountdown != null ? `RETRYING IN ${retryCountdown}` : 'ERROR'} />
        )}
      </div>
    </div>
  )
}
