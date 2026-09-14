import { useState } from 'react'

/** A small labelled button that copies `value` and confirms with a tick. */
export function InlineCopyButton({ label, value, displayUrl }: { label: string; value: string; displayUrl?: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={displayUrl ?? value}
      className="inline-flex items-center gap-1 shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[--color-surface-raised] border border-[--color-border] text-[--color-text-muted] hover:text-orange-500 hover:border-[--color-accent]/40 transition-colors cursor-pointer"
    >
      {copied ? (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 12l6 6L20 6" stroke="var(--color-pvw)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      <span className="uppercase tracking-wide">{label}</span>
    </button>
  )
}
