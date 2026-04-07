import { useEffect, useState } from 'react'
import { VideoTile } from '@/components/ui/VideoTile'
import { TallyLight } from '@/components/ui/TallyLight'
import { useTallyLight } from '@/hooks/useTallyLight'
import { getSourceStream } from '@/lib/webrtc'
import type { Source } from '@/store/sources.store'

interface MultiviewCellProps {
  source: Source
}

export function MultiviewCell({ source }: MultiviewCellProps) {
  const tally = useTallyLight(source.id)
  const [stream, setStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    let cancelled = false
    void getSourceStream(source).then((s) => {
      if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
      setStream(s)
    })
    return () => {
      cancelled = true
      setStream((prev) => { prev?.getTracks().forEach((t) => t.stop()); return null })
    }
  }, [source.id, source.color, source.name, source.liveCamera])

  return (
    <div className="relative bg-black">
      <VideoTile
        stream={stream}
        label={source.name}
        sublabel={source.type}
        tally={tally}
        className="w-full rounded-none"
      />
      <div className="absolute top-1.5 right-1.5">
        <TallyLight state={tally} size="sm" />
      </div>
    </div>
  )
}
