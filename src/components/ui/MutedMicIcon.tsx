import { cn } from '@/lib/cn'

interface MutedMicIconProps {
  /** Renders a stronger, harder-to-miss treatment — used when the muted guest
   * is on PVW or PGM, so an operator does not take a muted guest to air
   * unnoticed (studio#163, driven by `GUEST_STATE.muted`, open-live#382). */
  emphasized?: boolean
  className?: string
  size?: number
}

/** Mic-with-slash glyph shared by the Guests panel slot rows and the
 * vision-mixer PGM/PVW tile buttons (studio#163). */
export function MutedMicIcon({ emphasized = false, className, size = 11 }: MutedMicIconProps) {
  return (
    <span
      title={emphasized ? 'Guest is muted and on PVW/PGM' : 'Guest is muted'}
      className={cn(
        'inline-flex items-center justify-center rounded-full shrink-0',
        emphasized
          ? 'bg-red-600 text-white ring-2 ring-white animate-pulse'
          : 'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-600',
        className,
      )}
      style={{ width: size + 6, height: size + 6 }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 1a3 3 0 0 0-3 3v6.34" />
        <path d="M18.94 11.94A7 7 0 0 1 5.06 12M9 18.9A7 7 0 0 0 19 12M12 19v4" />
        <path d="M14.5 9.5V4a2.5 2.5 0 0 0-4.9-.66" />
        <line x1="2" y1="2" x2="22" y2="22" />
      </svg>
    </span>
  )
}
