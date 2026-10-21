/// <reference types="vitest/config" />
import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Reuse the app's Vite config (plugins + the `@/` path alias) so tests resolve
// imports exactly like the built app. Store and helper logic under test is pure
// TS that never touches the DOM, so the lighter `node` environment stays the
// default; component tests opt into jsdom per file with a
// `// @vitest-environment jsdom` comment (e.g. RecordingsPanel.test.tsx).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  }),
)
