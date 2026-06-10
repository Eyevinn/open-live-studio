/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly OPEN_LIVE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
