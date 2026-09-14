import { useServerInfo } from '@/hooks/useServerInfo'

/** The listener address that asks the backend to pick a free port. */
export const SRT_ASSIGN_LISTENER = 'srt://:0?mode=listener'

/**
 * One line under an SRT address field, saying which listener ports this
 * instance may use on the shared Strom. A hostless listener address
 * (`srt://:PORT?mode=listener`) binds PORT there, so the port has to come from
 * the instance's range and be free; port 0 lets the backend choose. Renders
 * nothing when the backend enforces no range.
 */
export function SrtPortHint() {
  const info = useServerInfo()
  if (!info) return null
  if (info.srtPortLease === 'pending') {
    return (
      <p className="text-xs text-[--color-text-muted] mt-1">
        Waiting for this instance&apos;s SRT port range from Strom. Listener addresses are refused until it arrives.
      </p>
    )
  }
  if (info.srtPortLease !== 'leased' || !info.srtPortRange) return null
  const { first, last } = info.srtPortRange
  return (
    <p className="text-xs text-[--color-text-muted] mt-1">
      Listener ports for this instance: {first}–{last}. <code>srt://:0?mode=listener</code> lets the server pick a free one.
    </p>
  )
}
