import { useViewerStore } from '@/store/viewer.store'
import { VideoTile } from '@/components/ui/VideoTile'
import { Badge } from '@/components/ui/Badge'

export function ProgramPreview() {
  const { programStream, connectionState } = useViewerStore()

  return (
    <div className="relative w-full max-w-6xl mx-auto">
      <VideoTile stream={programStream} label="Multiview" tally="off" />
      <div className="absolute bottom-2 right-2 pointer-events-none">
        {connectionState === 'connected' && <Badge variant="live" label="LIVE" />}
        {connectionState === 'connecting' && <Badge variant="connecting" label="CONNECTING" />}
        {connectionState === 'error' && <Badge variant="error" label="ERROR" />}
      </div>
    </div>
  )
}
