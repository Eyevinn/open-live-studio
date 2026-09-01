import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSourcesStore } from '@/store/sources.store'
import { useProductionStore } from '@/store/production.store'
import { VideoTile } from '@/components/ui/VideoTile'
import { useTallyLight } from '@/hooks/useTallyLight'
import { getSourceStream } from '@/lib/webrtc'

function SourceCell({ sourceId }: { sourceId: string }) {
  const source = useSourcesStore((s) => s.sources.find((src) => src.id === sourceId))
  const { setPvw, cut } = useProductionStore()
  const tally = useTallyLight(sourceId)
  const [stream, setStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    if (!source) return
    let cancelled = false
    void getSourceStream(source).then((s) => {
      if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
      setStream(s)
    })
    return () => {
      cancelled = true
      setStream((prev) => { prev?.getTracks().forEach((t) => t.stop()); return null })
    }
    // Depends on primitive fields, not the `source` object reference, which changes on every
    // unrelated store update (would cause constant stream reconnects).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, source?.color, source?.name, source?.liveCamera])

  if (!source) return null

  return (
    <VideoTile
      stream={stream}
      label={source.name}
      sublabel={source.address}
      tally={tally}
      onClick={() => setPvw(sourceId)}
      onDoubleClick={() => { setPvw(sourceId); cut() }}
      className="min-w-[140px]"
    />
  )
}

export function SourceBus() {
  const sources = useSourcesStore(useShallow((s) => s.sources))

  return (
    <div className="flex flex-col gap-2 p-4 bg-[--color-surface-3] rounded-xl border border-[--color-border]">
      <span className="text-xs font-bold uppercase tracking-widest text-[--color-text-muted]">
        Source Bus
      </span>
      <p className="text-[10px] text-[--color-text-muted]">Click to preview · Double-click to cut</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[...sources].sort((a, b) => a.name.localeCompare(b.name)).map((src) => (
          <div key={src.id} className="w-[140px] flex-shrink-0">
            <SourceCell sourceId={src.id} />
          </div>
        ))}
        {sources.length === 0 && (
          <p className="text-xs text-[--color-text-muted] py-4">No sources connected</p>
        )}
      </div>
    </div>
  )
}
