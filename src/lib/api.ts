const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type StreamType = 'srt' | 'whip'

export interface ApiSource {
  id: string
  name: string
  address: string
  streamType: StreamType
  status: 'active' | 'inactive'
  liveCamera?: boolean
}

export interface ProductionSourceAssignment {
  sourceId: string
  mixerInput: string
}

export interface ApiProduction {
  id: string
  name: string
  status: 'active' | 'inactive' | 'activating'
  sources: ProductionSourceAssignment[]
  templateId?: string
  stromFlowId?: string
  whepEndpoint?: string
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
  inputs: Array<{
    id: string
    blockId: string
    addressProperty: string
  }>
  createdAt: string
  updatedAt: string
}

type RawProduction = {
  _id: string
  name: string
  status: 'active' | 'inactive' | 'activating'
  sources: ProductionSourceAssignment[]
  templateId?: string
  stromFlowId?: string
  whepEndpoint?: string
}

function normalizeProduction(d: RawProduction): ApiProduction {
  return {
    id: d._id,
    name: d.name,
    status: d.status,
    sources: d.sources ?? [],
    templateId: d.templateId,
    stromFlowId: d.stromFlowId,
    whepEndpoint: d.whepEndpoint,
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

  update: (id: string, body: { name?: string; templateId?: string | null }) =>
    request<RawProduction>(`/api/v1/productions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }).then(normalizeProduction),

  activate: (id: string) =>
    request<RawProduction & { stromVersion?: string | null }>(`/api/v1/productions/${id}/activate`, { method: 'POST' })
      .then((d) => {
        console.log(`[Strom] version: ${d.stromVersion ?? 'unreachable'}`)
        return normalizeProduction(d)
      }),

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
