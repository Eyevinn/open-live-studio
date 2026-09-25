import { useServerInfo } from '@/hooks/useServerInfo'
import type { SrtDirection } from '@/lib/srt'

export const inputCls = 'w-full px-3 py-2 rounded bg-[--color-surface-raised] border border-[--color-border-strong] text-sm text-[--color-text-primary] focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30'
export const labelCls = 'text-xs text-[--color-text-muted] uppercase tracking-wider block mb-1'

/**
 * How a listener gets its port on this backend. `auto`: the backend holds ports
 * on the shared Strom and assigns a free one on save. `pending`: it is still
 * waiting for them, so nothing can be saved yet. `manual`: an older backend, or
 * one whose Strom hands out no ports, where the operator names the port.
 */
export type ListenerPortMode =
  | { kind: 'loading' }
  | { kind: 'auto'; ports: number[] }
  | { kind: 'pending' }
  | { kind: 'manual' }

export function useListenerPortMode(): ListenerPortMode {
  const { info, loaded } = useServerInfo()
  if (!loaded) return { kind: 'loading' }
  if (info?.srtPortState === 'pending') return { kind: 'pending' }
  if (info?.srtPortState === 'reserved' && info.srtPorts && info.srtPorts.length > 0) {
    return { kind: 'auto', ports: info.srtPorts }
  }
  return { kind: 'manual' }
}

/**
 * How a set of ports reads to an operator: runs where they are consecutive,
 * individual numbers where they are not. Strom prefers contiguous blocks, so
 * this is usually one range — but it cannot be assumed, and a list of eleven
 * numbers in a form label is worse than `47100–47109, 47250`.
 */
export function describePorts(ports: number[]): string {
  const sorted = [...ports].sort((a, b) => a - b)
  const runs: Array<[number, number]> = []
  for (const p of sorted) {
    const last = runs[runs.length - 1]
    if (last && last[1] + 1 === p) last[1] = p
    else runs.push([p, p])
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}\u2013${b}`)).join(', ')
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
            Assigned on save from this instance&apos;s ports {describePorts(mode.ports)}.
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
