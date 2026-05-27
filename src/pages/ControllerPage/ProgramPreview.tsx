import { useRef, useImperativeHandle, forwardRef, useEffect, useState, useCallback } from 'react'

const MAX_RETRIES = 5
import { useViewerStore } from '@/store/viewer.store'
import { VideoTile, type VideoTileHandle } from '@/components/ui/VideoTile'
import { Badge } from '@/components/ui/Badge'

export interface ProgramPreviewHandle {
  setMuted:      (muted: boolean) => void
  setVideoMuted: (muted: boolean) => void
}

interface ProgramPreviewProps {
  noSignal?: boolean
  audioOn: boolean
  onAudioOnChange: (v: boolean) => void
  audioTrack: number
  onAudioTrackChange: (i: number) => void
}

export const ProgramPreview = forwardRef<ProgramPreviewHandle, ProgramPreviewProps>(
  function ProgramPreview({ noSignal = false, audioOn, onAudioOnChange: _onAudioOnChange, audioTrack, onAudioTrackChange: _onAudioTrackChange }, ref) {
    const { programStream, connectionState, retryCountdown, retryAttempt, audioTrackCount } = useViewerStore()
    const tileRef = useRef<VideoTileHandle>(null)
    // Single-track: unmute video for direct output. Multi-track: AudioContext handles selection, keep video muted.
    const videoMuted = !audioOn || audioTrackCount > 1

    // hasVideoReady: true only when the video element is actually decoding frames.
    // Resets whenever connectionState leaves 'connected' so NO SIGNAL stays visible
    // during the gap between ICE connected and first decoded frame.
    const [hasVideoReady, setHasVideoReady] = useState(false)
    const handleHasVideo = useCallback((v: boolean) => setHasVideoReady(v), [])
    useEffect(() => {
      if (connectionState !== 'connected') setHasVideoReady(false)
    }, [connectionState])

    useImperativeHandle(ref, () => ({
      setMuted:      (m: boolean) => tileRef.current?.setMuted(m),
      setVideoMuted: (m: boolean) => tileRef.current?.setMuted(m),
    }))


    const audioCtxRef = useRef<AudioContext | null>(null)
    const audioSrcRef = useRef<MediaStreamAudioSourceNode | null>(null)

    useEffect(() => {
      audioSrcRef.current?.disconnect()
      audioSrcRef.current = null

      if (!audioOn || !programStream) return

      const tracks = programStream.getAudioTracks()
      if (tracks.length <= 1) return

      const ctx = audioCtxRef.current ?? new AudioContext()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') void ctx.resume()

      // Route each track through its own gain node; set gain=0 for non-selected tracks.
      // createMediaStreamSource on the full stream would mix all tracks regardless of track.enabled.
      const nodes = tracks.map((t, i) => {
        const src = ctx.createMediaStreamSource(new MediaStream([t]))
        const gain = ctx.createGain()
        gain.gain.value = i === audioTrack ? 1 : 0
        src.connect(gain)
        gain.connect(ctx.destination)
        return { src, gain }
      })

      return () => { nodes.forEach(({ src, gain }) => { gain.disconnect(); src.disconnect() }) }
    }, [audioOn, programStream, audioTrack])

    useEffect(() => () => { void audioCtxRef.current?.close() }, [])

    return (
      <div className="relative h-full aspect-video max-w-full border border-zinc-800 flex flex-col" style={{ background: '#000' }}>
        <div className="flex-1 min-h-0 relative">
          <VideoTile ref={tileRef} stream={programStream} label="" tally="off" className="h-full w-full" noSignal={noSignal} onHasVideo={handleHasVideo} />

          {/* Connection state badge — bottom right */}
          <div className="absolute bottom-2 right-2 pointer-events-none" style={{ zIndex: 2 }}>
            {connectionState === 'connected' && hasVideoReady && <Badge variant="live" label="LIVE" />}
            {(connectionState === 'connecting' || (connectionState === 'connected' && !hasVideoReady)) && (
              <Badge variant="connecting" label="CONNECTING" />
            )}
            {connectionState === 'error' && (
              <Badge variant="error" label={retryCountdown != null ? `RETRYING IN ${retryCountdown}` : 'RETRYING'} />
            )}
            {connectionState === 'failed' && <Badge variant="disconnected" label="SIGNAL LOST" />}
          </div>


        </div>
      </div>
    )
  }
)
