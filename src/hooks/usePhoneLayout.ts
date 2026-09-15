/**
 * usePhoneLayout — Tier 2 phone responsive hook (#105)
 *
 * Returns true when the viewport is below the `md` breakpoint (<768px), i.e.
 * phone width. Below this width the studio enters the reduced "operator-lite",
 * read-only mode recorded in docs/decisions/ADR-001-phone-tier-responsive-mode.md:
 * only glanceable status surfaces render and nothing that mutates state is exposed.
 *
 * The 768px boundary matches the `--breakpoint-md` value established by the
 * breakpoint foundation (#103) and Tailwind's default `md:` prefix, so the base
 * (unprefixed) tier is phone and `md:` and up is the existing desktop/tablet UI.
 */
import { useState, useEffect } from 'react'

const PHONE_QUERY = '(max-width: 767.98px)'

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY)
    const handler = (e: MediaQueryListEvent) => setIsPhone(e.matches)
    mq.addEventListener('change', handler)
    setIsPhone(mq.matches)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isPhone
}
