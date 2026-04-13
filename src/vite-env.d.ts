/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly OPEN_LIVE_URL: string
  readonly OSC_PAT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
