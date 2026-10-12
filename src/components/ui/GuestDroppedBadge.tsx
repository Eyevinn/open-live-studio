import { cn } from '@/lib/cn'

interface GuestDroppedBadgeProps {
  /** Renders a stronger, harder-to-miss treatment — used when the dropped
   * input is live on program / in the program PiP, so the operator gets an
   * explicit on-air drop signal (studio#193, split from open-live#491). */
  emphasized?: boolean
  className?: string
  size?: number
}

/**
 * "Guest dropped" warning glyph shown on a vision-mixer PGM/PVW tile or PiP
 * button when that input's guest left or was kicked (`GUEST_STATE` with
 * `state: 'left'`) while the input is live. Warning only — it never triggers a
 * cut; which source to take next stays the operator's call (studio#193). Mirrors
 * the MutedMicIcon badge pattern, placed top-left so it never collides with the
 * muted-mic / no-background badges (top-right).
 */
export function GuestDroppedBadge({ emphasized = false, className, size = 11 }: GuestDroppedBadgeProps) {
  return (
    <span
      role="img"
      aria-label="Guest dropped"
      title={
        emphasized
          ? 'Guest dropped while live — left or kicked. Cut away when ready.'
          : 'Guest dropped — left or was kicked.'
      }
      className={cn(
        'inline-flex items-center justify-center rounded-full shrink-0',
        emphasized
          ? 'bg-red-600 text-white ring-2 ring-white animate-pulse'
          : 'bg-red-900 text-red-200 ring-1 ring-red-500',
        className,
      )}
      style={{ width: size + 6, height: size + 6 }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* person silhouette with a slash — "participant gone" */}
        <path d="M6 20a6 6 0 0 1 9.2-5.07" />
        <circle cx="10" cy="7" r="3.2" />
        <line x1="3" y1="3" x2="21" y2="21" />
      </svg>
    </span>
  )
}
