import { useRef, useImperativeHandle, forwardRef } from 'react'
import { useViewerStore } from '@/store/viewer.store'
import { useAudioStore } from '@/store/audio.store'
import { VideoTile, type VideoTileHandle } from '@/components/ui/VideoTile'
import { Badge } from '@/components/ui/Badge'

export interface ProgramPreviewHandle {
  setMuted: (muted: boolean) => void
}

export const ProgramPreview = forwardRef<ProgramPreviewHandle>(function ProgramPreview(_, ref) {
  const { programStream, connectionState, retryCountdown } = useViewerStore()
  const tileRef = useRef<VideoTileHandle>(null)
  const pflState = useAudioStore((s) => s.pfl)
  const anyPfl = Object.values(pflState).some(Boolean)

  useImperativeHandle(ref, () => ({
    setMuted: (m: boolean) => tileRef.current?.setMuted(m),
  }))

  return (
    <div className="relative h-full aspect-video max-w-full border border-zinc-800" style={{ background: '#000' }}>
      <VideoTile ref={tileRef} stream={programStream} label="" tally="off" className="h-full w-full" />

      {/* Connection state badge — bottom right */}
      <div className="absolute bottom-2 right-2 pointer-events-none">
        {connectionState === 'connected' && <Badge variant="live" label="LIVE" />}
        {connectionState === 'connecting' && <Badge variant="connecting" label="CONNECTING" />}
        {connectionState === 'error' && (
          <Badge variant="error" label={retryCountdown != null ? `RETRYING IN ${retryCountdown}` : 'ERROR'} />
        )}
      </div>

      {/* PFL monitor indicator — top left, shown when any channel is PFL'd */}
      {anyPfl && (
        <div className="absolute top-2 left-2 pointer-events-none">
          <span
            className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5"
            style={{ background: 'rgba(180,140,0,0.85)', color: '#fef08a', border: '1px solid #ca8a04' }}
          >
            PFL
          </span>
        </div>
      )}
    </div>
  )
})
