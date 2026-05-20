import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { WhepClient } from '@/lib/webrtc'
import { getApiToken } from '@/lib/sat'
import { Badge } from '@/components/ui/Badge'
import type { ViewerConnectionState } from '@/store/viewer.store'
import { BASE as API_BASE } from '@/lib/base'

interface PgmChannel { label: string; url: string }

interface PgmPreviewProps {
  channels: PgmChannel[]
  selectedUrl?: string
  onSelectUrl?: (url: string) => void
  audioOn: boolean
  onAudioOnChange: (v: boolean) => void
  audioTrack: number
  onAudioTrackChange: (i: number) => void
  onAudioTrackCount?: (n: number) => void
}

export interface PgmPreviewHandle {
  setVideoMuted: (muted: boolean) => void
}

/**
 * Self-contained PGM program monitor. Establishes its own WHEP connection
 * independently of the multiviewer — does NOT use the shared viewer store,
 * so the two streams can coexist in the same page without conflicting.
 */
export const PgmPreview = forwardRef<PgmPreviewHandle, PgmPreviewProps>(function PgmPreview({ channels, selectedUrl, onSelectUrl: _onSelectUrl, audioOn, onAudioOnChange: _onAudioOnChange, audioTrack, onAudioTrackChange: _onAudioTrackChange, onAudioTrackCount }: PgmPreviewProps, ref) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useImperativeHandle(ref, () => ({
    setVideoMuted: (m: boolean) => { if (videoRef.current) videoRef.current.muted = m },
  }))
  const [connectionState, setConnectionState] = useState<ViewerConnectionState>('disconnected')
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null)
  const clientRef = useRef<WhepClient | null>(null)

  const whepEndpoint = selectedUrl ?? channels[0]?.url

  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioSrcRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [audioTrackCount, setAudioTrackCount] = useState(0)

  useEffect(() => {
    onAudioTrackCount?.(audioTrackCount)
  }, [audioTrackCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // AudioContext only used for multi-track selection. Single-track audio is
  // handled by leaving the video element unmuted (avoids double playback).
  useEffect(() => {
    audioSrcRef.current?.disconnect()
    audioSrcRef.current = null

    if (!audioOn || !streamRef.current) return
    const tracks = streamRef.current.getAudioTracks()
    if (tracks.length <= 1) return

    const ctx = audioCtxRef.current ?? new AudioContext()
    audioCtxRef.current = ctx
    if (ctx.state === 'suspended') void ctx.resume()

    const nodes = tracks.map((t, i) => {
      const src = ctx.createMediaStreamSource(new MediaStream([t]))
      const gain = ctx.createGain()
      gain.gain.value = i === audioTrack ? 1 : 0
      src.connect(gain)
      gain.connect(ctx.destination)
      return { src, gain }
    })

    return () => { nodes.forEach(({ src, gain }) => { gain.disconnect(); src.disconnect() }) }
  }, [audioOn, audioTrack, audioTrackCount])

  useEffect(() => () => { void audioCtxRef.current?.close() }, [])

  useEffect(() => {
    if (!whepEndpoint) return
    let cancelled = false
    let countdownTimer: ReturnType<typeof setInterval> | null = null
    let authToken: string | undefined

    setAudioTrackCount(0)
    streamRef.current = null

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
            if (cancelled) return
            streamRef.current = stream
            if (videoRef.current) videoRef.current.srcObject = stream
            setAudioTrackCount(stream.getAudioTracks().length)
            stream.onaddtrack = (e) => {
              if (e.track.kind === 'audio' && !cancelled) {
                setAudioTrackCount(stream.getAudioTracks().length)
              }
            }
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

  const showNoSignal = connectionState !== 'connected'
  // Unmute video for single-track (direct output). Mute when AudioContext handles it (multi-track).
  const videoMuted = !audioOn || audioTrackCount > 1

  return (
    <div className="relative h-full aspect-video max-w-full border border-zinc-800 flex flex-col" style={{ background: '#000' }}>
      <div className="flex-1 min-h-0 relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={videoMuted}
          className="h-full w-full object-contain"
          style={{ visibility: showNoSignal ? 'hidden' : 'visible' }}
        />
        {showNoSignal && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900" style={{ zIndex: 1 }}>
            <span className="text-zinc-500 text-xs font-mono uppercase tracking-widest">NO SIGNAL</span>
          </div>
        )}
        <div className="absolute bottom-2 right-2 pointer-events-none">
          {connectionState === 'connected'  && <Badge variant="live"       label="LIVE" />}
          {connectionState === 'connecting' && <Badge variant="connecting" label="CONNECTING" />}
          {connectionState === 'error'      && (
            <Badge variant="error" label={retryCountdown != null ? `RETRYING IN ${retryCountdown}` : 'ERROR'} />
          )}
        </div>
      </div>
    </div>
  )
})
