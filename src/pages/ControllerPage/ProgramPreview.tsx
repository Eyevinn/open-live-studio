import { useRef, useImperativeHandle, forwardRef } from 'react'
import { useViewerStore } from '@/store/viewer.store'
import { VideoTile, type VideoTileHandle } from '@/components/ui/VideoTile'
import { Badge } from '@/components/ui/Badge'

export interface ProgramPreviewHandle {
  setMuted: (muted: boolean) => void
}

export const ProgramPreview = forwardRef<ProgramPreviewHandle>(function ProgramPreview(_, ref) {
  const { programStream, connectionState, retryCountdown } = useViewerStore()
  const tileRef = useRef<VideoTileHandle>(null)

  useImperativeHandle(ref, () => ({
    setMuted: (m: boolean) => tileRef.current?.setMuted(m),
  }))

  return (
    <div className="relative h-full aspect-video max-w-full">
      <VideoTile ref={tileRef} stream={programStream} label="Multiview" tally="off" className="h-full w-full" />
      <div className="absolute bottom-2 right-2 pointer-events-none">
        {connectionState === 'connected' && <Badge variant="live" label="LIVE" />}
        {connectionState === 'connecting' && <Badge variant="connecting" label="CONNECTING" />}
        {connectionState === 'error' && (
          <Badge variant="error" label={retryCountdown != null ? `RETRYING IN ${retryCountdown}` : 'ERROR'} />
        )}
      </div>
    </div>
  )
})
