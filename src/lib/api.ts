export { BASE } from './base.js'
import { BASE } from './base.js'
import { authenticateWithOpenLive, getApiToken } from './sat.js'

// Paths that manage their own error toasts — skip global handler
const SILENT_PATHS = ['/api/v1/status', '/api/v1/reconnect']

interface RequestOptions extends RequestInit {
  // Status codes to treat as success (no toast, no throw). Useful for idempotent deletes.
  silentStatuses?: number[]
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  await authenticateWithOpenLive()
  const token = await getApiToken()
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const contentHeaders: Record<string, string> = init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}

  const { silentStatuses, ...fetchInit } = init ?? {}
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...contentHeaders, ...authHeaders },
    ...fetchInit,
  })
  if (!res.ok) {
    if (silentStatuses?.includes(res.status)) return undefined as T
    const err = await res.json().catch(() => ({ error: res.statusText }))
    const message = (err as { error?: string }).error ?? res.statusText
    if (!SILENT_PATHS.includes(path)) {
      const { useToastStore } = await import('../store/toast.store')
      const { upsertToastByTag } = useToastStore.getState()
      if (res.status === 503) {
        const { runReconnect } = await import('../hooks/useConnectionCheck')
        upsertToastByTag('connection', 'Connection issues detected:', 'error', {
          persistent: true,
          onReconnect: runReconnect,
          issues: ['Database unreachable'],
          mergeIssues: true,
        })
      } else {
        const { isInitialCheckDone } = await import('../hooks/useConnectionCheck')
        if (isInitialCheckDone()) {
          upsertToastByTag('api-error', message, 'error', { persistent: false })
        }
      }
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type StreamType = 'srt' | 'efp' | 'whip' | 'test1' | 'test2' | 'html' | 'clip'

/**
 * Authenticated-HTML-source material, mirroring the accepted spec
 * (`open-live` `docs/specs/authenticated-html-sources.md`, backend PR #332).
 *
 * IMPORTANT contract notes — do not invent fields:
 *  - `header.value` is **write-only**: it is accepted on PATCH, encrypted at
 *    rest, and NEVER returned by the API. On read the backend echoes only
 *    `header.valueSet` (whether a value is stored).
 *  - `profile` material is server-issued and gated (Design C); its provisioning
 *    endpoint returns `501` in v1, so Studio does not drive it here.
 *
 * The live-cookie-forwarding design (issue #129's original sketch, "Design A")
 * was **rejected outright** by the spec — there is no `/session` endpoint and no
 * cookie is ever forwarded. See the header-credential (Design B) flow instead.
 */
export interface HtmlSourceAuth {
  mode: 'header' | 'profile'
  header?: {
    name: string
    /** Read-only echo: whether a credential value is stored. Value never returned. */
    valueSet?: boolean
  }
  profile?: {
    profileId: string
    status: 'unprovisioned' | 'provisioned' | 'expired'
    lastProvisionedAt?: string
  }
}

/** Write-only `auth` payload for PATCH — `header.value` accepted, never echoed back. */
export interface HtmlSourceAuthInput {
  mode: 'header' | 'profile'
  header?: {
    name: string
    /** Write-only: sent once, encrypted at rest server-side. Empty string clears it. */
    value?: string
  }
}

export interface ApiSource {
  id: string
  name: string
  address: string
  streamType: StreamType
  status: 'active' | 'inactive'
  liveCamera?: boolean
  latency?: number
  /**
   * Id of the Gateway (open-live `GatewayDoc._id`) that registered this source,
   * if any. Present only on gateway-owned sources; the gateway recreates these
   * each heartbeat, so Studio locks Edit/Delete for them (open-live #263).
   */
  gatewayId?: string
  /**
   * Authenticated-HTML-source material (open-live #332). Present only on
   * `streamType: 'html'` sources that have been configured. `header.value` is
   * never present here — the API masks it to `header.valueSet`.
   */
  auth?: HtmlSourceAuth
}

export interface ProductionSourceAssignment {
  sourceId: string
  mixerInput: string
}

export interface ProductionGraphicAssignment {
  graphicId: string
  dskInput: string
}

export type OutputType = 'mpegtssrt' | 'efpsrt' | 'whep'

export interface ApiOutput {
  id: string
  name: string
  outputType: OutputType
  url?: string
  createdAt: string
  updatedAt: string
}

export interface ProductionOutputAssignment {
  outputId: string
}

export interface ApiProduction {
  id: string
  name: string
  status: 'active' | 'inactive' | 'activating'
  sources: ProductionSourceAssignment[]
  graphicAssignments?: ProductionGraphicAssignment[]
  outputAssignments?: ProductionOutputAssignment[]
  whepOutputUrls?: Array<{ outputId: string; url: string }>
  stromFlowId?: string
  whepEndpoint?: string
  pgmWhepEndpoint?: string
  whipEndpoints?: Array<{ mixerInput: string; url: string }>
  srtOutputUri?: string
  values?: Record<string, string | number | boolean>
  airTime?: string
  deletionWarnings?: Array<{ type: 'source' | 'graphic' | 'output'; name: string }>
  autoDeactivated?: boolean
  subscriberCount?: number
  /** Unix ms timestamp when this production will be auto-deactivated due to idle. Set by backend watchdog. */
  idleExpiresAt?: number
  /** Negotiated input resolutions from Strom, indexed by mixer input position. Null = caps not yet negotiated. */
  inputResolutions?: Array<{ width: number; height: number } | null>
}

export interface ProductionConfig {
  _id: string
  name: string
  values: Record<string, string | number | boolean>
  createdAt: string
  updatedAt: string
}

type RawProduction = {
  _id: string
  name: string
  status: 'active' | 'inactive' | 'activating'
  sources: ProductionSourceAssignment[]
  graphicAssignments?: ProductionGraphicAssignment[]
  outputAssignments?: ProductionOutputAssignment[]
  whepOutputUrls?: Array<{ outputId: string; url: string }>
  stromFlowId?: string
  whepEndpoint?: string
  pgmWhepEndpoint?: string
  whipEndpoints?: Array<{ mixerInput: string; url: string }>
  srtOutputUri?: string
  values?: Record<string, string | number | boolean>
  airTime?: string
  deletionWarnings?: Array<{ type: 'source' | 'graphic' | 'output'; name: string }>
  autoDeactivated?: boolean
  subscriberCount?: number
  idleExpiresAt?: number
  inputResolutions?: Array<{ width: number; height: number } | null>
}

function normalizeProduction(d: RawProduction): ApiProduction {
  return {
    id: d._id,
    name: d.name,
    status: d.status,
    sources: d.sources ?? [],
    graphicAssignments: d.graphicAssignments ?? [],
    outputAssignments: d.outputAssignments ?? [],
    whepOutputUrls: d.whepOutputUrls,
    stromFlowId: d.stromFlowId,
    whepEndpoint: d.whepEndpoint,
    pgmWhepEndpoint: d.pgmWhepEndpoint,
    whipEndpoints: d.whipEndpoints,
    srtOutputUri: d.srtOutputUri,
    values: d.values,
    airTime: d.airTime,
    deletionWarnings: d.deletionWarnings,
    autoDeactivated: d.autoDeactivated,
    subscriberCount: d.subscriberCount,
    idleExpiresAt: d.idleExpiresAt,
    inputResolutions: d.inputResolutions,
  }
}

export const productionsApi = {
  list: () =>
    request<RawProduction[]>('/api/v1/productions')
      .then((docs) => docs.map(normalizeProduction)),

  get: (id: string) =>
    request<RawProduction>(`/api/v1/productions/${encodeURIComponent(id)}`)
      .then(normalizeProduction),

  create: (body: { name: string }) =>
    request<RawProduction>('/api/v1/productions', {
      method: 'POST',
      body: JSON.stringify(body),
    }).then(normalizeProduction),

  update: (id: string, body: { name?: string; values?: Record<string, string | number | boolean>; airTime?: string | null }) =>
    request<RawProduction>(`/api/v1/productions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }).then(normalizeProduction),

  activate: (id: string) =>
    request<RawProduction>(`/api/v1/productions/${encodeURIComponent(id)}/activate`, { method: 'POST' })
      .then(normalizeProduction),

  deactivate: (id: string) =>
    request<RawProduction>(`/api/v1/productions/${encodeURIComponent(id)}/deactivate`, { method: 'POST' })
      .then(normalizeProduction),

  remove: (id: string) =>
    request<void>(`/api/v1/productions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  assignSource: (id: string, body: ProductionSourceAssignment) =>
    request<ProductionSourceAssignment & { _rev: string }>(`/api/v1/productions/${encodeURIComponent(id)}/sources`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  unassignSource: (id: string, mixerInput: string) =>
    request<void>(`/api/v1/productions/${encodeURIComponent(id)}/sources/${encodeURIComponent(mixerInput)}`, { method: 'DELETE', silentStatuses: [404] }),

  assignGraphic: (id: string, body: ProductionGraphicAssignment) =>
    request<ProductionGraphicAssignment & { _rev: string }>(`/api/v1/productions/${encodeURIComponent(id)}/graphics`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  unassignGraphic: (id: string, dskInput: string) =>
    request<void>(`/api/v1/productions/${encodeURIComponent(id)}/graphics/${encodeURIComponent(dskInput)}`, { method: 'DELETE' }),

  assignOutput: (id: string, outputId: string) =>
    request<ProductionOutputAssignment & { _rev: string }>(`/api/v1/productions/${encodeURIComponent(id)}/outputs`, {
      method: 'POST',
      body: JSON.stringify({ outputId }),
    }),

  unassignOutput: (id: string, outputId: string) =>
    request<void>(`/api/v1/productions/${encodeURIComponent(id)}/outputs/${encodeURIComponent(outputId)}`, { method: 'DELETE' }),
}

export const sourcesApi = {
  list: () =>
    request<ApiSource[]>('/api/v1/sources'),

  create: (body: Omit<ApiSource, 'id'>) =>
    request<ApiSource>('/api/v1/sources', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: Partial<Omit<ApiSource, 'id'>>) =>
    request<ApiSource>(`/api/v1/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /**
   * Set/replace the authenticated-HTML-source `auth` object (Design B — header
   * credential). Hits the real `PATCH /api/v1/sources/:id` surface that backend
   * PR #332 extended. `header.value` is write-only; the response masks it to
   * `header.valueSet`. `409` if the source is in an active production.
   */
  updateAuth: (id: string, auth: HtmlSourceAuthInput) =>
    request<ApiSource>(`/api/v1/sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ auth }),
    }),

  /**
   * Rotate or clear the stored header credential (open-live #332,
   * `POST /api/v1/sources/:id/auth/rotate`). Send a new value, or an empty
   * string / no value to clear it. Mirrors the gateway-token rotate (ADR-001).
   */
  rotateAuth: (id: string, value?: string) =>
    request<ApiSource>(`/api/v1/sources/${encodeURIComponent(id)}/auth/rotate`, {
      method: 'POST',
      body: JSON.stringify(value !== undefined ? { value } : {}),
    }),

  remove: (id: string) =>
    request<void>(`/api/v1/sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

// --------------- Gateway types (open-live #263, OL-5/OL-6 Studio Gateways Phase 1) ---------------

/**
 * Gateway health, derived compute-on-read on the backend from the last heartbeat.
 * Matches the open-live `GatewayHealth` vocabulary exactly — there is deliberately
 * no `degraded` value.
 */
export type GatewayHealth = 'healthy' | 'down' | 'unknown'

/** Strom FlowState vocabulary reported per gateway input (open-live `GatewayInputFlowState`). */
export type GatewayInputFlowState = 'idle' | 'playing' | 'paused'

export interface GatewayUplink {
  bitrateKbps: number
  rtt_ms: number
  dropped: number
}

export interface GatewayInputStatus {
  inputId: string
  name: string
  flowState: GatewayInputFlowState
  /** References the Open Live source (`ApiSource.id`) this input registered, if any. */
  sourceId: string | null
  uplink: GatewayUplink | null
}

/**
 * A venue gateway box as returned by `GET /api/v1/gateways`. The snapshot fields
 * (`host`, `stromVersion`, `deviceCount`, `streamingCount`, `inputs`) reflect the
 * last heartbeat and are absent until the first heartbeat arrives.
 */
export interface ApiGateway {
  id: string
  name: string
  health: GatewayHealth
  lastSeenAt: string | null
  host?: string
  stromVersion?: string
  deviceCount?: number
  streamingCount?: number
  inputs?: GatewayInputStatus[]
  createdAt: string
  updatedAt: string
}

export const gatewaysApi = {
  list: () =>
    request<ApiGateway[]>('/api/v1/gateways'),

  get: (id: string) =>
    request<ApiGateway>(`/api/v1/gateways/${encodeURIComponent(id)}`),
}

// --------------- Macro types ---------------

export interface ApiMacroAction {
  type: 'CUT' | 'TRANSITION' | 'TAKE' | 'GRAPHIC_ON' | 'GRAPHIC_OFF' | 'DSK_TOGGLE'
  sourceId?: string
  transitionType?: string
  durationMs?: number
  overlayId?: string
  layer?: number
  visible?: boolean
}

export interface ApiMacro {
  id: string
  slot: number
  label: string
  color: string
  actions: ApiMacroAction[]
}

export interface ApiAudioElement {
  id: string
  blockId: string
  elementId: string
  label: string
  mixerInput: string | null
}

export const macrosApi = {
  list: (productionId: string) =>
    request<ApiMacro[]>(`/api/v1/productions/${encodeURIComponent(productionId)}/macros`),

  create: (productionId: string, body: Omit<ApiMacro, 'id'>) =>
    request<ApiMacro>(`/api/v1/productions/${encodeURIComponent(productionId)}/macros`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (productionId: string, macroId: string, body: Partial<Omit<ApiMacro, 'id'>>) =>
    request<ApiMacro>(`/api/v1/productions/${encodeURIComponent(productionId)}/macros/${encodeURIComponent(macroId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (productionId: string, macroId: string) =>
    request<void>(`/api/v1/productions/${encodeURIComponent(productionId)}/macros/${encodeURIComponent(macroId)}`, { method: 'DELETE' }),
}

export const audioApi = {
  discoverElements: (productionId: string) =>
    request<ApiAudioElement[]>(`/api/v1/productions/${encodeURIComponent(productionId)}/audio`),

  getElement: (productionId: string, elementId: string) =>
    request<{ element_id: string; properties: Record<string, unknown> }>(
      `/api/v1/productions/${encodeURIComponent(productionId)}/audio/${encodeURIComponent(elementId)}`,
    ),

  updateElement: (productionId: string, elementId: string, body: { property: string; value: unknown }) =>
    request<{ element_id: string; properties: Record<string, unknown> }>(
      `/api/v1/productions/${encodeURIComponent(productionId)}/audio/${encodeURIComponent(elementId)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
}

export const iceServersApi = {
  get: () =>
    request<{ iceServers: RTCIceServer[] }>('/api/v1/ice-servers'),
}

export interface ApiStatus {
  db: boolean
  strom: boolean
}

export const statusApi = {
  get: () => request<ApiStatus>('/api/v1/status'),
  reconnect: () => request<{ ok: boolean; db: boolean; strom: boolean }>('/api/v1/reconnect', { method: 'POST' }),
}

/** What the backend says about its Strom. Older backends report only `stromHost`. */
export interface ServerInfo {
  stromHost: string
  /** SRT listener ports this instance may bind on the shared Strom; null unless `srtPortLease` is `leased`. */
  srtPortRange?: { first: number; last: number } | null
  /** `pending` means the range is not known yet; `unsupported`/`disabled` mean any port goes. */
  srtPortLease?: 'leased' | 'pending' | 'unsupported' | 'disabled'
}

export const serverInfoApi = {
  get: () => request<ServerInfo>('/api/v1/server-info'),
}

export const productionConfigsApi = {
  list: () =>
    request<ProductionConfig[]>('/api/v1/production-configs'),

  create: (body: { name: string; values: Record<string, string | number | boolean> }) =>
    request<ProductionConfig>('/api/v1/production-configs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: { name?: string; values?: Record<string, string | number | boolean> }) =>
    request<ProductionConfig>(`/api/v1/production-configs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/api/v1/production-configs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

export interface ApiGraphic {
  id: string
  name: string
  url: string
  createdAt: string
  updatedAt: string
}

export const graphicsApi = {
  list: () =>
    request<ApiGraphic[]>('/api/v1/graphics'),

  create: (body: { name: string; url: string }) =>
    request<ApiGraphic>('/api/v1/graphics', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: { name?: string; url?: string }) =>
    request<ApiGraphic>(`/api/v1/graphics/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/api/v1/graphics/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

export const outputsApi = {
  list: () =>
    request<ApiOutput[]>('/api/v1/outputs'),

  create: (body: { name: string; outputType: OutputType; url?: string }) =>
    request<ApiOutput>('/api/v1/outputs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: { name?: string; url?: string }) =>
    request<ApiOutput>(`/api/v1/outputs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/api/v1/outputs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
