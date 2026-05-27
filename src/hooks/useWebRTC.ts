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
  const clearProgramStream = useViewerStore((s) => s.clearProgramStream)
  const setConnectionState = useViewerStore((s) => s.setConnectionState)
  const setRetryCountdown = useViewerStore((s) => s.setRetryCountdown)
  const setRetryAttempt = useViewerStore((s) => s.setRetryAttempt)
  const setAudioTrackCount = useViewerStore((s) => s.setAudioTrackCount)
  const disconnect = useViewerStore((s) => s.disconnect)
  const clientRef = useRef<WhepClient | null>(null)

  useEffect(() => {
    if (!whepEndpoint) {
      disconnect()
      return
    }

    let cancelled = false
    let countdownTimer: ReturnType<typeof setInterval> | null = null
    let disconnectWatchdog: ReturnType<typeof setTimeout> | null = null
    let retryCount = 0
    let generation = 0
    const MAX_RETRIES = 5

    setConnectionState('connecting')
    setRetryAttempt(0)

    const startCountdown = (seconds: number, onDone: () => void) => {
      if (countdownTimer) clearInterval(countdownTimer)
      setRetryCountdown(seconds)
      let remaining = seconds - 1
      countdownTimer = setInterval(() => {
        if (cancelled) { clearInterval(countdownTimer!); return }
        if (remaining <= 0) {
          clearInterval(countdownTimer!)
          countdownTimer = null
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

    const triggerRetry = () => {
      if (cancelled) return
      clearProgramStream()
      retryCount++
      setRetryAttempt(retryCount)
      if (retryCount >= MAX_RETRIES) {
        setConnectionState('failed')
        // Schedule a background recovery attempt so an extended offline period
        // doesn't strand the viewer permanently. The 'online' handler fires
        // first if the browser detects network return sooner.
        if (disconnectWatchdog) { clearTimeout(disconnectWatchdog); disconnectWatchdog = null }
        disconnectWatchdog = setTimeout(() => {
          if (cancelled) return
          // One attempt per 30s cycle — set to MAX_RETRIES-1 so the next
          // failure immediately re-arms the 30s timer rather than cycling
          // through 5 retries again.
          retryCount = MAX_RETRIES - 1
          setRetryAttempt(retryCount)
          connect()
        }, 30_000)
      } else {
        setConnectionState('error')
        startCountdown(3, connect)
      }
    }

    const connect = () => {
      if (cancelled) return
      const myGen = ++generation
      if (clientRef.current) {
        // close() immediately — don't send DELETE so Strom's pipeline stays
        // warm for the new session. disconnect() (with DELETE) is only used on
        // intentional teardown in the effect cleanup below.
        clientRef.current.close()
        clientRef.current = null
      }
      setConnectionState('connecting')
      const client = new WhepClient(whepEndpoint, {
        onVideoTrack: (stream) => {
          if (cancelled || generation !== myGen) return
          setProgramStream(stream, false)
          setAudioTrackCount(stream.getAudioTracks().length)
          stream.onaddtrack = (e) => {
            if (e.track.kind === 'audio' && !cancelled && generation === myGen) {
              setAudioTrackCount(stream.getAudioTracks().length)
            }
          }
        },
        onConnected: () => {
          if (cancelled || generation !== myGen) return
          if (disconnectWatchdog) { clearTimeout(disconnectWatchdog); disconnectWatchdog = null }
          if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; setRetryCountdown(null) }
          retryCount = 0
          setRetryAttempt(0)
          setConnectionState('connected')
        },
        onDisconnected: () => {
          if (cancelled || generation !== myGen) return
          clearProgramStream()
          setConnectionState('disconnected')
          // ICE 'disconnected' can fire multiple times (flappy network) — always clear
          // the old watchdog before arming a new one to avoid stacked timers that would
          // fire triggerRetry() many times and exhaust retryCount instantly.
          if (disconnectWatchdog) { clearTimeout(disconnectWatchdog); disconnectWatchdog = null }
          disconnectWatchdog = setTimeout(() => {
            if (cancelled || generation !== myGen) return
            // Watchdog: ICE stayed disconnected for 5 s. Start a fresh reconnect rather
            // than calling triggerRetry() — this is not a WHEP failure, so don't consume
            // the retry budget. Reset retryCount so onError gets a full set of attempts.
            retryCount = 0
            setRetryAttempt(0)
            connect()
          }, 5000)
        },
        onError: () => {
          if (cancelled || generation !== myGen) return
          if (disconnectWatchdog) { clearTimeout(disconnectWatchdog); disconnectWatchdog = null }
          triggerRetry()
        },
      }, { iceServersUrl: `${API_BASE}/api/v1/ice-servers`, proxyUrl: `${API_BASE}/api/v1/whep-proxy`, authToken })
      clientRef.current = client
      void client.connect()
    }

    // Immediately reconnect when the browser detects network return.
    // Fires before the 30s background watchdog, so recovery is near-instant
    // after the wifi comes back up.
    const handleOnline = () => {
      if (cancelled || clientRef.current?.isConnected()) return
      // A connection attempt is already in progress (PC open, ICE gathering/checking).
      // Let it proceed — don't layer a second attempt on top.
      if (clientRef.current?.isActive()) return
      if (disconnectWatchdog) { clearTimeout(disconnectWatchdog); disconnectWatchdog = null }
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; setRetryCountdown(null) }
      // One attempt on network return — same budget as the 30s cycle.
      retryCount = MAX_RETRIES - 1
      setRetryAttempt(retryCount)
      connect()
    }
    window.addEventListener('online', handleOnline)

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
      window.removeEventListener('online', handleOnline)
      if (countdownTimer) clearInterval(countdownTimer)
      if (disconnectWatchdog) clearTimeout(disconnectWatchdog)
      setRetryCountdown(null)
      if (clientRef.current) {
        void clientRef.current.disconnect()
        clientRef.current = null
      } else {
        disconnect()
      }
    }
  }, [whepEndpoint, setProgramStream, clearProgramStream, setConnectionState, setRetryCountdown, setRetryAttempt, setAudioTrackCount, disconnect])
}
