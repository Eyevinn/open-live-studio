import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSourcesStore } from '@/store/sources.store'
import { useProductionStore } from '@/store/production.store'
import { VideoTile } from '@/components/ui/VideoTile'
import { useTallyLight } from '@/hooks/useTallyLight'
import { getSourceStream } from '@/lib/webrtc'
import { cn } from '@/lib/cn'

function SourceCell({
  sourceId,
  role,
  onClick,
}: {
  sourceId: string
  role: 'pvw' | 'pgm' | 'off'
  onClick: () => void
}) {
  const source = useSourcesStore((s) => s.sources.find((src) => src.id === sourceId))
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
  }, [source?.id, source?.color, source?.name, source?.liveCamera])

  if (!source) return null

  return (
    <div
      className={cn(
        'w-[120px] flex-shrink-0 rounded overflow-hidden cursor-pointer ring-2 transition-all',
        role === 'pgm' ? 'ring-[--color-pgm]' : role === 'pvw' ? 'ring-[--color-pvw]' : 'ring-transparent',
      )}
      onClick={onClick}
    >
      <VideoTile
        stream={stream}
        label={source.name}
        tally={tally}
        className="w-full"
      />
    </div>
  )
}

export function SourceBusDual() {
  const sources = useSourcesStore(useShallow((s) => s.sources))
  const { pgmInput: pgmSourceId, pvwInput: pvwSourceId, setPvw, cut } = useProductionStore()

  if (sources.length === 0) {
    return (
      <div className="p-4 bg-[--color-surface-3] rounded-xl border border-[--color-border]">
        <p className="text-xs text-[--color-text-muted]">No sources connected</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 bg-[--color-surface-3] rounded-xl border border-[--color-border]">
      {/* PVW row */}
      <div className="flex flex-col gap-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-[--color-pvw]">Preview</span>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {sources.map((src) => (
            <SourceCell
              key={src.id}
              sourceId={src.id}
              role={src.id === pvwSourceId ? 'pvw' : 'off'}
              onClick={() => setPvw(src.id)}
            />
          ))}
        </div>
      </div>
      {/* PGM row */}
      <div className="flex flex-col gap-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-[--color-pgm]">Program</span>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {sources.map((src) => (
            <SourceCell
              key={src.id}
              sourceId={src.id}
              role={src.id === pgmSourceId ? 'pgm' : 'off'}
              onClick={() => { setPvw(src.id); cut() }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
