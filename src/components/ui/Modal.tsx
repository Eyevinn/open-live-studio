import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}

export function Modal({ open, title, onClose, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className={cn(
          'bg-[#1e1e1e] border border-[var(--color-border-strong)] rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.4)] w-full max-w-lg mx-4 flex flex-col',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-5 shrink-0">
          <h2 className="text-base font-bold text-[--color-text-primary]">{title}</h2>
          <Button variant="ghost" size="md" aria-label="Close" onClick={onClose} className="px-2 py-2 text-lg leading-none">✕</Button>
        </div>
        <div className="overflow-y-auto px-6 pb-6">
          {children}
        </div>
      </div>
    </div>
  )
}
