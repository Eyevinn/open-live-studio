export const BASE = (
  (typeof window !== 'undefined' && (window as unknown as { _env_?: { OPEN_LIVE_URL?: string } })._env_?.OPEN_LIVE_URL) ||
  import.meta.env.OPEN_LIVE_URL ||
  'http://localhost:3000'
).replace(/\/$/, '')
