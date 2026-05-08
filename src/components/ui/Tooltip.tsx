import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  title?: string
  className?: string
}

export function Tooltip({ content, children, title, className }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)

  const show = useCallback(() => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setPos({ top: r.top + window.scrollY, left: r.left + r.width / 2 + window.scrollX })
    setVisible(true)
  }, [])

  const hide = useCallback(() => setVisible(false), [])

  return (
    <>
      <span ref={triggerRef} onMouseEnter={show} onMouseLeave={hide} className={className}>
        {children}
      </span>
      {visible && createPortal(
        <div
          className="pointer-events-none fixed z-[9999]"
          style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
        >
          <div className="mb-2">
            <div className="bg-zinc-800 border border-zinc-600 rounded shadow-lg overflow-hidden">
              {title && (
                <div className="px-2.5 py-1 border-b border-zinc-700 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                  {title}
                </div>
              )}
              <div className="px-2.5 py-1.5">
                {content}
              </div>
            </div>
          </div>
          <div className="flex justify-center">
            <div className="w-2 h-2 bg-zinc-800 border-r border-b border-zinc-600 rotate-45 -mt-3" />
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
