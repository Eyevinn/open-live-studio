/**
 * useTabletLayout — Tier 1 tablet responsive hook (#104)
 *
 * Returns true when the viewport is in the tablet range (768–1024px).
 * Used to scale audio fader height down so strips stay usable without
 * horizontal scroll at narrow widths.
 */
import { useState, useEffect } from 'react'

const TABLET_QUERY = '(max-width: 1024px) and (min-width: 768px)'

export function useIsTablet(): boolean {
  const [isTablet, setIsTablet] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(TABLET_QUERY).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(TABLET_QUERY)
    const handler = (e: MediaQueryListEvent) => setIsTablet(e.matches)
    mq.addEventListener('change', handler)
    setIsTablet(mq.matches)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isTablet
}
