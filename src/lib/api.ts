// Runtime env injection: docker-entrypoint.sh writes /env-config.js which sets
// window._env_.OPEN_LIVE_URL so the backend URL can be changed without rebuilding
// the image (required for OSC parameter store injection).
export const BASE =
  (typeof window !== 'undefined' && (window as unknown as { _env_?: { OPEN_LIVE_URL?: string } })._env_?.OPEN_LIVE_URL) ||
  import.meta.env.OPEN_LIVE_URL ||
  'http://localhost:3000'

import { getApiToken } from './sat.js'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getApiToken()
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const contentHeaders: Record<string, string> = init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}

  const res = await fetch(`${BASE}${path}`, {
    headers: { ...contentHeaders, ...authHeaders },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type StreamType = 'srt' | 'efp' | 'whip' | 'test1' | 'test2' | 'html'

export interface ApiSource {
  id: string
  name: string
  address: string
  streamType: StreamType
  status: 'active' | 'inactive'
  liveCamera?: boolean
  latency?: number
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
  templateId?: string
  stromFlowId?: string
  whepEndpoint?: string
  pgmWhepEndpoint?: string
  whipEndpoints?: Array<{ mixerInput: string; url: string }>
  srtOutputUri?: string
  values?: Record<string, string | number>
  airTime?: string
  deletionWarnings?: Array<{ type: 'source' | 'graphic' | 'output'; name: string }>
}

export interface TemplateProperty {
  id: string
  label: string
  type: 'select' | 'text' | 'number'
  default: string | number
  options?: Array<{ value: string; label: string }>
  min?: number
  max?: number
  unit?: string
}

export interface ApiTemplate {
  id: string
  name: string
  description?: string
  flow: {
    elements: unknown[]
    blocks: unknown[]
    links: unknown[]
  }
  inputs: Array<{ id: string }>
  audioElements?: ApiAudioElement[]
  properties?: TemplateProperty[]
  createdAt: string
  updatedAt: string
}

export interface ProductionConfig {
  _id: string
  name: string
  templateId: string
  values: Record<string, string | number>
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
  templateId?: string
  stromFlowId?: string
  whepEndpoint?: string
  pgmWhepEndpoint?: string
  whipEndpoints?: Array<{ mixerInput: string; url: string }>
  srtOutputUri?: string
  values?: Record<string, string | number>
  airTime?: string
  deletionWarnings?: Array<{ type: 'source' | 'graphic' | 'output'; name: string }>
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
    templateId: d.templateId,
    stromFlowId: d.stromFlowId,
    whepEndpoint: d.whepEndpoint,
    pgmWhepEndpoint: d.pgmWhepEndpoint,
    whipEndpoints: d.whipEndpoints,
    srtOutputUri: d.srtOutputUri,
    values: d.values,
    airTime: d.airTime,
    deletionWarnings: d.deletionWarnings,
  }
}

export const productionsApi = {
  list: () =>
    request<RawProduction[]>('/api/v1/productions')
      .then((docs) => docs.map(normalizeProduction)),

  get: (id: string) =>
    request<RawProduction>(`/api/v1/productions/${id}`)
      .then(normalizeProduction),

  create: (body: { name: string }) =>
    request<RawProduction>('/api/v1/productions', {
      method: 'POST',
      body: JSON.stringify(body),
    }).then(normalizeProduction),

  update: (id: string, body: { name?: string; templateId?: string | null; values?: Record<string, string | number>; airTime?: string | null }) =>
    request<RawProduction>(`/api/v1/productions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }).then(normalizeProduction),

  activate: (id: string) =>
    request<RawProduction>(`/api/v1/productions/${id}/activate`, { method: 'POST' })
      .then(normalizeProduction),

  deactivate: (id: string) =>
    request<RawProduction>(`/api/v1/productions/${id}/deactivate`, { method: 'POST' })
      .then(normalizeProduction),

  remove: (id: string) =>
    request<void>(`/api/v1/productions/${id}`, { method: 'DELETE' }),

  assignSource: (id: string, body: ProductionSourceAssignment) =>
    request<ProductionSourceAssignment & { _rev: string }>(`/api/v1/productions/${id}/sources`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  unassignSource: (id: string, mixerInput: string) =>
    request<void>(`/api/v1/productions/${id}/sources/${encodeURIComponent(mixerInput)}`, { method: 'DELETE' }),

  assignGraphic: (id: string, body: ProductionGraphicAssignment) =>
    request<ProductionGraphicAssignment & { _rev: string }>(`/api/v1/productions/${id}/graphics`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  unassignGraphic: (id: string, dskInput: string) =>
    request<void>(`/api/v1/productions/${id}/graphics/${encodeURIComponent(dskInput)}`, { method: 'DELETE' }),

  assignOutput: (id: string, outputId: string) =>
    request<ProductionOutputAssignment & { _rev: string }>(`/api/v1/productions/${id}/outputs`, {
      method: 'POST',
      body: JSON.stringify({ outputId }),
    }),

  unassignOutput: (id: string, outputId: string) =>
    request<void>(`/api/v1/productions/${id}/outputs/${encodeURIComponent(outputId)}`, { method: 'DELETE' }),
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
    request<ApiSource>(`/api/v1/sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/api/v1/sources/${id}`, { method: 'DELETE' }),
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

export interface ApiStreamingStats {
  active: boolean
  rtpStats?: unknown
  webrtcStats?: unknown
  error?: string
}

export const macrosApi = {
  list: (productionId: string) =>
    request<ApiMacro[]>(`/api/v1/productions/${productionId}/macros`),

  create: (productionId: string, body: Omit<ApiMacro, 'id'>) =>
    request<ApiMacro>(`/api/v1/productions/${productionId}/macros`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (productionId: string, macroId: string, body: Partial<Omit<ApiMacro, 'id'>>) =>
    request<ApiMacro>(`/api/v1/productions/${productionId}/macros/${macroId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (productionId: string, macroId: string) =>
    request<void>(`/api/v1/productions/${productionId}/macros/${macroId}`, { method: 'DELETE' }),
}

export const audioApi = {
  discoverElements: (productionId: string) =>
    request<ApiAudioElement[]>(`/api/v1/productions/${productionId}/audio`),

  getElement: (productionId: string, elementId: string) =>
    request<{ element_id: string; properties: Record<string, unknown> }>(
      `/api/v1/productions/${productionId}/audio/${elementId}`,
    ),

  updateElement: (productionId: string, elementId: string, body: { property: string; value: unknown }) =>
    request<{ element_id: string; properties: Record<string, unknown> }>(
      `/api/v1/productions/${productionId}/audio/${elementId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
}

export const statsApi = {
  streaming: (productionId: string) =>
    request<ApiStreamingStats>(`/api/v1/productions/${productionId}/stats/streaming`),
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
}

export const productionConfigsApi = {
  listAll: () =>
    request<ProductionConfig[]>('/api/v1/production-configs'),

  list: (templateId: string) =>
    request<ProductionConfig[]>(`/api/v1/production-configs?templateId=${encodeURIComponent(templateId)}`),

  create: (body: { name: string; templateId: string; values: Record<string, string | number> }) =>
    request<ProductionConfig>('/api/v1/production-configs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: { name?: string; values?: Record<string, string | number> }) =>
    request<ProductionConfig>(`/api/v1/production-configs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/api/v1/production-configs/${id}`, { method: 'DELETE' }),
}

export const templatesApi = {
  list: () =>
    request<ApiTemplate[]>('/api/v1/templates'),

  create: (body: Omit<ApiTemplate, 'id' | 'createdAt' | 'updatedAt'>) =>
    request<ApiTemplate>('/api/v1/templates', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  get: (id: string) =>
    request<ApiTemplate>(`/api/v1/templates/${id}`),

  update: (id: string, body: Partial<Omit<ApiTemplate, 'id' | 'createdAt' | 'updatedAt'>>) =>
    request<ApiTemplate>(`/api/v1/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/api/v1/templates/${id}`, { method: 'DELETE' }),
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
    request<ApiGraphic>(`/api/v1/graphics/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/api/v1/graphics/${id}`, { method: 'DELETE' }),
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
    request<ApiOutput>(`/api/v1/outputs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (id: string) =>
    request<void>(`/api/v1/outputs/${id}`, { method: 'DELETE' }),
}
