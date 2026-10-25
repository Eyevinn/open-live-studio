import { cn } from '@/lib/cn'

interface Props {
  /** Brighter variant for a tile that is lit (on PGM / PVW). */
  emphasized?: boolean
  className?: string
}

/**
 * Small "REC" mark on a vision-mixer input tile whose input the running
 * activation records to its own files (`RECORDING_STATE`, OL-32, studio#233).
 */
export function RecordingIndicator({ emphasized, className }: Props) {
  return (
    <span
      role="img"
      aria-label="Recording this input"
      className={cn(
        'absolute bottom-0.5 left-0.5 inline-flex items-center gap-0.5 leading-none pointer-events-none select-none font-bold tracking-wider',
        emphasized ? 'text-white' : 'text-red-500',
        className,
      )}
      style={{ fontSize: 7 }}
    >
      <span className={cn('inline-block w-1.5 h-1.5 rounded-full animate-pulse', emphasized ? 'bg-white' : 'bg-red-500')} />
      REC
    </span>
  )
}
