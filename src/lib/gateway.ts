import type { ApiGateway, GatewayHealth, GatewayInputStatus } from '@/lib/api'

/** Human "N min ago"-style age for a heartbeat/last-seen ISO timestamp. */
export function heartbeatAge(lastSeenAt: string | null | undefined): string {
  if (!lastSeenAt) return 'never'
  const ms = Date.parse(lastSeenAt)
  if (Number.isNaN(ms)) return 'never'
  const secs = Math.floor((Date.now() - ms) / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`
  return `${Math.floor(secs / 3600)}h ago`
}

/** StatusDot colour for a gateway health value. */
export function healthDotColor(health: GatewayHealth): 'green' | 'yellow' | 'gray' {
  switch (health) {
    case 'healthy': return 'green'
    case 'down': return 'yellow'
    default: return 'gray'
  }
}

/** Short human label for a gateway health value. */
export function healthLabel(health: GatewayHealth): string {
  switch (health) {
    case 'healthy': return 'Online'
    case 'down': return 'Offline'
    default: return 'Never seen'
  }
}

/**
 * Build a lookup from source id -> the owning gateway plus the input that
 * registered it, so the Sources tab can render live uplink stats and a
 * "via <gateway>" chip without re-fetching per source.
 */
export interface GatewaySourceLink {
  gateway: ApiGateway
  input?: GatewayInputStatus
}

export function indexGatewaysBySource(gateways: ApiGateway[]): Map<string, GatewaySourceLink> {
  const bySource = new Map<string, GatewaySourceLink>()
  for (const gateway of gateways) {
    for (const input of gateway.inputs ?? []) {
      if (input.sourceId) bySource.set(input.sourceId, { gateway, input })
    }
  }
  return bySource
}
