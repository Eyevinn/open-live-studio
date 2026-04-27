import { NavLink } from 'react-router'
import { cn } from '@/lib/cn'
import { useProductionStore } from '@/store/production.store'
import { ConnectionStatus } from '@/components/ui/ConnectionStatus'

function OpenLiveLogo() {
  // Expanded viewBox (-2 -2 40 40) gives 2px breathing room so the circle stroke isn't clipped.
  // Play triangle shifted 1px right for optical centering (play shapes read left-heavy).
  // Red dot sits on the circumference at 45° top-right: (18+15.5·cos45°, 18−15.5·sin45°) ≈ (29,7).
  return (
    <svg width="34" height="34" viewBox="-2 -2 40 40" fill="none" aria-label="Open Live">
      <circle cx="18" cy="18" r="15.5" stroke="var(--color-accent)" strokeWidth="1.5" />
      <path d="M16 12.5L27.5 18L16 23.5V12.5Z" fill="var(--color-accent)" />
      <circle cx="29" cy="7" r="3.5" fill="var(--color-live)" />
    </svg>
  )
}

function IOIcon() {
  // Bidirectional arrows — left-pointing on top, right-pointing on bottom
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M4 8h16M4 8l3-3M4 8l3 3" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 16H4M20 16l-3-3M20 16l-3 3" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ProductionsIcon() {
  // Clapperboard
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="8" width="18" height="13" rx="1.5" stroke="var(--color-accent)" strokeWidth="1.5" />
      <path d="M3 12h18" stroke="var(--color-accent)" strokeWidth="1.5" />
      <path d="M7 8L5 12" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11 8L9 12" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15 8l-2 4" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M19 8l-2 4" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

const NAV_ITEMS = [
  { to: '/setup',       label: 'I/O',         Icon: IOIcon },
  { to: '/productions', label: 'Productions', Icon: ProductionsIcon },
]

export function NavBar() {
  const isLive = useProductionStore((s) => s.isLive)

  return (
    <nav className="flex flex-col items-stretch w-16 bg-[--color-surface-2] border-r border-[--color-border] flex-shrink-0">
      {/* Logo */}
      <div className="h-14 flex items-center justify-center border-b border-[--color-border]">
        <OpenLiveLogo />
      </div>

      {/* Nav items */}
      <div className="flex-1 flex flex-col gap-1 p-1.5 pt-3">
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-1 py-3 rounded text-[10px] font-medium transition-all',
                isActive
                  ? 'bg-[--color-accent] text-[--color-text-dark]'
                  : 'text-[--color-text-muted] hover:text-[--color-text-primary] hover:bg-[rgba(89,203,232,0.1)]',
              )
            }
          >
            <Icon />
            <span className="leading-none">{label}</span>
          </NavLink>
        ))}
      </div>

      {/* Bottom: ON AIR when live, connection status always */}
      <div className="p-1.5 pb-5 flex flex-col gap-2">
        {isLive && (
          <div className="w-full py-1.5 rounded text-[9px] font-mono font-bold text-center uppercase tracking-widest bg-[--color-live] text-white animate-pulse">
            ON AIR
          </div>
        )}
        <ConnectionStatus />
      </div>
    </nav>
  )
}
