import { NavLink } from 'react-router'
import { cn } from '@/lib/cn'
import { useProductionStore } from '@/store/production.store'
import { ConnectionStatus } from '@/components/ui/ConnectionStatus'

function OpenLiveLogo() {
  return (
    <div className="flex items-center gap-2" aria-label="Open Live">
      <div className="w-3 h-3 bg-orange-500 shrink-0" />
      <div className="flex flex-col" style={{ lineHeight: 1.1 }}>
        <span className="text-[10px] font-bold tracking-[0.2em] text-orange-500">OPEN</span>
        <span className="text-[10px] font-bold tracking-[0.2em] text-orange-500">LIVE</span>
      </div>
    </div>
  )
}

function IOIcon() {
  // Bidirectional arrows — left-pointing on top, right-pointing on bottom
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <path d="M4 8h16M4 8l3-3M4 8l3 3" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 16H4M20 16l-3-3M20 16l-3 3" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ProductionsIcon() {
  // Clapperboard
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
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
    <nav className="flex flex-col items-stretch w-24 bg-[--color-surface-2] border-r border-[--color-border] flex-shrink-0">
      {/* Logo — h-11 matches PageHeader height so the border-b lines up */}
      <div className="h-11 flex items-center justify-center border-b border-[--color-border]">
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
