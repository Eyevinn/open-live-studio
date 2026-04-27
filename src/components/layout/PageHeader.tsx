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
      'flex items-center justify-between px-4 h-11 border-b border-zinc-800 flex-shrink-0 bg-black',
      className,
    )}>
      <div className="flex items-center gap-3">
        <div>
          {typeof title === 'string' ? (
            <h1 className="text-[11px] font-bold uppercase tracking-[0.12em] text-white">{title}</h1>
          ) : (
            title
          )}
          {subtitle && <p className="text-[9px] uppercase tracking-widest text-zinc-500 mt-0">{subtitle}</p>}
        </div>
      </div>
      {center && <div className="flex items-center gap-6">{center}</div>}
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  )
}
