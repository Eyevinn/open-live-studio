import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  envPrefix: ['OPEN_LIVE_', 'OSC_'],
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    // Explicit: never ship TS source maps in production (closes #56).
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api/v1': 'http://localhost:8080',
    },
  },
})
