import { useViewerStore } from '@/store/viewer.store'
import { VideoTile } from '@/components/ui/VideoTile'
import { Badge } from '@/components/ui/Badge'

export function ProgramPreview() {
  const { programStream, connectionState } = useViewerStore()

  const label = connectionState === 'connected'
    ? 'Multiview Output'
    : connectionState === 'connecting'
      ? 'Connecting…'
      : 'No Active Production'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[--color-pgm]">Multiviewer</span>
        {connectionState === 'connected' && <Badge variant="live" label="LIVE" />}
        {connectionState === 'connecting' && <Badge variant="connecting" label="CONNECTING" />}
        {connectionState === 'error' && <Badge variant="error" label="ERROR" />}
      </div>
      <VideoTile stream={programStream} label={label} tally="pgm" />
    </div>
  )
}
