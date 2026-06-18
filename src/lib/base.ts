declare global { interface Window { _env_?: Record<string, string> } }

export const BASE = (
  window._env_?.OPEN_LIVE_URL ||
  import.meta.env.OPEN_LIVE_URL ||
  'http://localhost:3000'
).replace(/\/$/, '')
