import { cn } from '@/lib/cn'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: ReactNode
  subtitle?: string
  center?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, center, actions, className }: PageHeaderProps) {
  return (
    <div className={cn(
      'flex items-center justify-between px-4 h-14 border-b border-white flex-shrink-0 bg-black',
      className,
    )}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          {typeof title === 'string' ? (
            <h1 className="text-[11px] font-bold uppercase tracking-[0.12em] text-white truncate">{title}</h1>
          ) : (
            title
          )}
          {subtitle && <p className="text-[9px] uppercase tracking-widest text-zinc-500 mt-0">{subtitle}</p>}
        </div>
      </div>
      {center && <div className="flex items-center gap-6">{center}</div>}
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </div>
  )
}
