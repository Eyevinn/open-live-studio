/// <reference types="vitest/config" />
import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Reuse the app's Vite config (plugins + the `@/` path alias) so tests resolve
// imports exactly like the built app. Store and helper logic under test is pure
// TS that never touches the DOM, so the lighter `node` environment is enough —
// switch to `jsdom` here when component tests are added later.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  }),
)
