/**
 * OperatorLiteNotice — Tier 2 phone (<768px) operate-blocked message (#105)
 *
 * Rendered in place of the mixer / studio controller below 768px. Per the phone
 * -tier product decision (docs/decisions/ADR-001-phone-tier-responsive-mode.md),
 * the controller is NOT rendered at phone width — the operator sees glanceable
 * read-only status only and this notice where operate controls would otherwise be.
 */
import { cn } from '@/lib/cn'

interface OperatorLiteNoticeProps {
  className?: string
}

function TabletIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-accent)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </svg>
  )
}

export function OperatorLiteNotice({ className }: OperatorLiteNoticeProps) {
  return (
    <div
      className={cn(
        'flex flex-1 min-h-0 flex-col items-center justify-center gap-4 p-8 text-center',
        className,
      )}
      role="status"
    >
      <TabletIcon />
      <p className="text-sm font-bold uppercase tracking-[0.12em] text-[--color-text-primary]">
        Use a tablet or wider to operate
      </p>
      <p className="max-w-xs text-xs text-[--color-text-muted]">
        Live controls are hidden on phone-sized screens. Open Live Studio on a
        tablet or larger display to operate the mixer. Tally and production status
        remain available here.
      </p>
    </div>
  )
}
