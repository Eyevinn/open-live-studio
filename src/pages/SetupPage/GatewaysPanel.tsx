import { useEffect } from 'react'
import { useGatewaysStore } from '@/store/gateways.store'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { StatusDot } from '@/components/ui/StatusDot'
import { Badge } from '@/components/ui/Badge'
import type { ApiGateway, GatewayInputFlowState, GatewayInputStatus } from '@/lib/api'
import { heartbeatAge, healthDotColor, healthLabel } from '@/lib/gateway'

const POLL_INTERVAL_MS = 5000

function timeSince(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ago`
}

const FLOW_STATE_VARIANT: Record<GatewayInputFlowState, 'running' | 'idle'> = {
  playing: 'running',
  paused: 'idle',
  idle: 'idle',
}

const FLOW_STATE_LABEL: Record<GatewayInputFlowState, string> = {
  playing: 'Running',
  paused: 'Paused',
  idle: 'Idle',
}

/** Uplink summary line for one input: bitrate + RTT, or the "no receiver" fallback. */
function uplinkSummary(input: GatewayInputStatus): string {
  if (!input.uplink) return 'no receiver'
  const { bitrateKbps, rtt_ms, dropped } = input.uplink
  const mbps = (bitrateKbps / 1000).toFixed(1)
  const droppedNote = dropped > 0 ? ` · ${dropped} dropped` : ''
  return `${mbps} Mbps · ${rtt_ms} ms RTT${droppedNote}`
}

interface InputRowProps {
  input: GatewayInputStatus
  /** Open Live registration status for the source this input registered. */
  registration: 'active' | 'inactive' | 'not-registered'
  /** Name of the production this input's source is assigned to, if any. */
  production: string | null
}

function InputRow({ input, registration, production }: InputRowProps) {
  const registrationLabel =
    registration === 'active' ? 'Active'
      : registration === 'inactive' ? 'Inactive'
        : 'Not registered'
  const registrationColor =
    registration === 'active' ? 'text-emerald-400'
      : registration === 'inactive' ? 'text-[--color-text-muted]'
        : 'text-yellow-400'
  return (
    <tr className="border-t border-[--color-border]">
      <td className="py-1.5 pr-3 text-[--color-text-primary]">{input.name}</td>
      <td className="py-1.5 pr-3 font-mono text-[--color-text-muted]">{input.inputId}</td>
      <td className="py-1.5 pr-3">
        <Badge variant={FLOW_STATE_VARIANT[input.flowState]} label={FLOW_STATE_LABEL[input.flowState]} />
      </td>
      <td className="py-1.5 pr-3 font-mono text-[--color-text-muted]">{uplinkSummary(input)}</td>
      <td className={`py-1.5 pr-3 ${registrationColor}`}>{registrationLabel}</td>
      <td className="py-1.5 text-[--color-text-muted]">{production ?? '—'}</td>
    </tr>
  )
}

interface GatewayCardProps {
  gateway: ApiGateway
  /** source id -> production name, for the input assignment column. */
  productionBySource: Map<string, string>
  /** source id -> Open Live registration status. */
  registrationBySource: Map<string, 'active' | 'inactive'>
}

function GatewayCard({ gateway, productionBySource, registrationBySource }: GatewayCardProps) {
  const inputs = gateway.inputs ?? []
  return (
    <div className="rounded border border-[--color-border] bg-[--color-surface-3]">
      {/* Card header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 border-b border-[--color-border]">
        <StatusDot color={healthDotColor(gateway.health)} pulse={gateway.health === 'healthy'} />
        <span className="text-sm font-semibold text-[--color-text-primary]">{gateway.name}</span>
        <span className="text-xs text-[--color-text-muted]">
          {healthLabel(gateway.health)} · last seen {heartbeatAge(gateway.lastSeenAt)}
        </span>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-mono text-[--color-text-muted]">
          {gateway.host && <span title="Host">{gateway.host}</span>}
          {gateway.stromVersion && <span title="Local Strom version">Strom {gateway.stromVersion}</span>}
          {gateway.deviceCount != null && <span title="Devices">{gateway.deviceCount} devices</span>}
          {gateway.streamingCount != null && <span title="Streaming">{gateway.streamingCount} streaming</span>}
        </div>
      </div>

      {/* Inputs table */}
      {inputs.length === 0 ? (
        <p className="px-4 py-3 text-xs text-[--color-text-muted]">
          {gateway.lastSeenAt ? 'No inputs reported in the last heartbeat.' : 'No heartbeat received yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto px-4 py-2">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-[--color-text-muted] uppercase tracking-wider">
                <th className="py-1.5 pr-3 font-medium">Input</th>
                <th className="py-1.5 pr-3 font-medium">Flow</th>
                <th className="py-1.5 pr-3 font-medium">State</th>
                <th className="py-1.5 pr-3 font-medium">Uplink</th>
                <th className="py-1.5 pr-3 font-medium">Open Live</th>
                <th className="py-1.5 font-medium">Production</th>
              </tr>
            </thead>
            <tbody>
              {inputs.map((input) => {
                const reg = input.sourceId ? registrationBySource.get(input.sourceId) : undefined
                const registration = input.sourceId
                  ? (reg ?? 'inactive')
                  : 'not-registered'
                const production = input.sourceId ? productionBySource.get(input.sourceId) ?? null : null
                return (
                  <InputRow
                    key={input.inputId}
                    input={input}
                    registration={registration}
                    production={production}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function GatewaysPanel() {
  const { gateways, isLoading, lastFetchedAt, fetchAll } = useGatewaysStore()
  const productions = useProductionsStore((s) => s.productions)
  const sources = useSourcesStore((s) => s.sources)

  useEffect(() => {
    void fetchAll()
    const id = setInterval(() => void fetchAll(), POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  // source id -> production name (first production the source is assigned to).
  const productionBySource = new Map<string, string>()
  for (const p of productions) {
    for (const s of p.sources) {
      if (!productionBySource.has(s.sourceId)) productionBySource.set(s.sourceId, p.name)
    }
  }

  // source id -> Open Live registration status, from the Sources list.
  const registrationBySource = new Map<string, 'active' | 'inactive'>()
  for (const s of sources) registrationBySource.set(s.id, s.status)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[--color-text-muted] font-mono">
          {gateways.length} {gateways.length === 1 ? 'gateway' : 'gateways'} · refreshed {timeSince(lastFetchedAt)}
        </span>
        {isLoading && <span className="text-xs text-[--color-accent]">Refreshing…</span>}
      </div>

      {gateways.length === 0 ? (
        <div className="rounded border border-dashed border-[--color-border] px-4 py-8 text-center text-sm text-[--color-text-muted]">
          No gateways registered. Register a venue gateway box on Open Live to see it here.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {[...gateways].sort((a, b) => a.name.localeCompare(b.name)).map((gateway) => (
            <GatewayCard
              key={gateway.id}
              gateway={gateway}
              productionBySource={productionBySource}
              registrationBySource={registrationBySource}
            />
          ))}
        </div>
      )}
    </div>
  )
}
