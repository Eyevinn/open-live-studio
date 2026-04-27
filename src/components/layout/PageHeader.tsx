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
      'flex items-center justify-between px-6 h-14 border-b border-[--color-border] flex-shrink-0',
      className,
    )}>
      <div>
        <h1 className="text-xl font-bold text-[--color-text-primary]">{title}</h1>
        {subtitle && <p className="text-xs text-[--color-text-muted] mt-0.5">{subtitle}</p>}
      </div>
      {center && <div className="flex items-center gap-6">{center}</div>}
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  )
}
