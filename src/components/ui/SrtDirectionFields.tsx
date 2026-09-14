import { useServerInfo } from '@/hooks/useServerInfo'
import type { SrtDirection } from '@/lib/srt'

export const inputCls = 'w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30'
export const labelCls = 'text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1'

/**
 * How a listener gets its port on this backend. `auto`: the backend holds a
 * range on the shared Strom and assigns a free port on save. `pending`: it is
 * still waiting for that range, so nothing can be saved yet. `manual`: an older
 * backend, or one with no managed range, where the operator names the port.
 */
export type ListenerPortMode =
  | { kind: 'loading' }
  | { kind: 'auto'; first: number; last: number }
  | { kind: 'pending' }
  | { kind: 'manual' }

export function useListenerPortMode(): ListenerPortMode {
  const { info, loaded } = useServerInfo()
  if (!loaded) return { kind: 'loading' }
  if (info?.srtPortLease === 'pending') return { kind: 'pending' }
  if (info?.srtPortLease === 'leased' && info.srtPortRange) {
    return { kind: 'auto', first: info.srtPortRange.first, last: info.srtPortRange.last }
  }
  return { kind: 'manual' }
}

/** The port to put in a listener address, or null when none can be chosen yet. */
export function listenerPortFor(mode: ListenerPortMode, manualPort: string, keep?: number | null): number | null {
  if (keep) return keep
  if (mode.kind === 'auto') return 0
  if (mode.kind === 'manual') {
    const p = parseInt(manualPort, 10)
    return Number.isInteger(p) && p > 0 && p <= 65535 ? p : null
  }
  return null
}

/** Whether Save is possible in listener mode right now. */
export function listenerReady(mode: ListenerPortMode, manualPort: string, keep?: number | null): boolean {
  return listenerPortFor(mode, manualPort, keep) !== null
}

export function DirectionToggle({
  value, onChange, listenerLabel, callerLabel,
}: { value: SrtDirection; onChange: (d: SrtDirection) => void; listenerLabel: string; callerLabel: string }) {
  const cls = (active: boolean) =>
    `py-2 rounded text-sm border transition-colors ${
      active
        ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
        : 'bg-[var(--color-surface-2)] border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-orange-500'
    }`
  return (
    <div>
      <label className={labelCls}>Direction</label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={cls(value === 'listener')} onClick={() => onChange('listener')}>{listenerLabel}</button>
        <button type="button" className={cls(value === 'caller')} onClick={() => onChange('caller')}>{callerLabel}</button>
      </div>
    </div>
  )
}

/**
 * The fields of a listener: how the port is chosen, and an optional passphrase.
 * `keepPort` is the port an existing document already holds; it is kept as is.
 */
export function ListenerFields({
  mode, manualPort, onManualPort, passphrase, onPassphrase, keepPort, hasPassphrase,
}: {
  mode: ListenerPortMode
  manualPort: string
  onManualPort: (v: string) => void
  passphrase: string
  onPassphrase: (v: string) => void
  keepPort?: number | null
  hasPassphrase?: boolean
}) {
  return (
    <>
      <div>
        <label className={labelCls}>Port on the Strom server</label>
        {keepPort ? (
          <p className="text-sm text-[--color-text-primary] font-mono">{keepPort}</p>
        ) : mode.kind === 'loading' ? (
          <p className="text-xs text-[--color-text-muted]">Checking how ports are assigned…</p>
        ) : mode.kind === 'auto' ? (
          <p className="text-xs text-[--color-text-muted]">
            Assigned automatically on save: the lowest free port in this instance&apos;s range {mode.first}–{mode.last}.
          </p>
        ) : mode.kind === 'pending' ? (
          <p className="text-xs text-amber-400">
            This instance is still waiting for its port range from Strom. Try again in a minute.
          </p>
        ) : (
          <>
            <input
              type="number"
              min={1}
              max={65535}
              value={manualPort}
              placeholder="e.g. 9000"
              onChange={(e) => onManualPort(e.target.value)}
              className={inputCls}
            />
            <p className="text-xs text-[--color-text-muted] mt-1">
              This instance has no managed port range, so pick a UDP port that is open on the Strom server and not in use.
            </p>
          </>
        )}
      </div>
      <div>
        <label className={labelCls}>
          Passphrase <span className="normal-case opacity-60">(optional, 10–79 characters)</span>
        </label>
        <input
          type="text"
          value={passphrase}
          placeholder={hasPassphrase ? 'Set — leave blank to keep' : 'None'}
          onChange={(e) => onPassphrase(e.target.value)}
          className={inputCls}
        />
      </div>
    </>
  )
}
