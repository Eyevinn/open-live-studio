import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  title?: string
  className?: string
}

const TOOLTIP_W = 280
const TOOLTIP_ESTIMATE_H = 120 // rough max height for above-check
const GAP = 8

export function Tooltip({ content, children, title, className }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, below: false })
  const triggerRef = useRef<HTMLSpanElement>(null)

  const show = useCallback(() => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()

    const rawLeft = r.left + r.width / 2 + window.scrollX
    const left = Math.min(
      Math.max(rawLeft, TOOLTIP_W / 2 + GAP),
      window.innerWidth - TOOLTIP_W / 2 - GAP,
    )

    const spaceAbove = r.top
    const below = spaceAbove < TOOLTIP_ESTIMATE_H + GAP

    const top = below
      ? r.bottom + window.scrollY + GAP
      : r.top + window.scrollY

    setPos({ top, left, below })
    setVisible(true)
  }, [])

  const hide = useCallback(() => setVisible(false), [])

  return (
    <>
      <span ref={triggerRef} onMouseEnter={show} onMouseLeave={hide} className={className} style={{ cursor: 'help' }}>
        {children}
      </span>
      {visible && createPortal(
        <div
          className="pointer-events-none fixed z-[9999]"
          style={{
            top: pos.top,
            left: pos.left,
            transform: pos.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            width: TOOLTIP_W,
          }}
        >
          {!pos.below && (
            <div className="mb-2">
              <div className="bg-zinc-800 border border-zinc-600 rounded shadow-lg overflow-hidden">
                {title && (
                  <div className="px-2.5 py-1 border-b border-zinc-700 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                    {title}
                  </div>
                )}
                <div className="px-2.5 py-1.5 text-[11px] text-zinc-300 leading-relaxed whitespace-normal">
                  {content}
                </div>
              </div>
            </div>
          )}
          {!pos.below && (
            <div className="flex justify-center">
              <div className="w-2 h-2 bg-zinc-800 border-r border-b border-zinc-600 rotate-45 -mt-3" />
            </div>
          )}
          {pos.below && (
            <>
              <div className="flex justify-center mb-1">
                <div className="w-2 h-2 bg-zinc-800 border-l border-t border-zinc-600 rotate-45" />
              </div>
              <div className="bg-zinc-800 border border-zinc-600 rounded shadow-lg overflow-hidden">
                {title && (
                  <div className="px-2.5 py-1 border-b border-zinc-700 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                    {title}
                  </div>
                )}
                <div className="px-2.5 py-1.5 text-[11px] text-zinc-300 leading-relaxed whitespace-normal">
                  {content}
                </div>
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
