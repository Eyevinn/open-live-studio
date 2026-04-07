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

export interface ApiSource {
  id: string
  name: string
  address: string
  status: 'active' | 'inactive'
  liveCamera?: boolean
}

export interface ApiProduction {
  id: string
  name: string
  status: 'active' | 'inactive'
}

type RawProduction = { _id: string; name: string; status: 'active' | 'inactive' }

function normalizeProduction(d: RawProduction): ApiProduction {
  return { id: d._id, name: d.name, status: d.status }
}

export const productionsApi = {
  list: () =>
    request<RawProduction[]>('/api/v1/productions')
      .then((docs) => docs.map(normalizeProduction)),

  create: (body: { name: string }) =>
    request<RawProduction>('/api/v1/productions', {
      method: 'POST',
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
