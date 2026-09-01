import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { router } from './app'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// Global safety net for unhandled promise rejections and uncaught errors.
// These won't crash the tab but will log clearly for debugging.
window.addEventListener('unhandledrejection', (e) => {
  // eslint-disable-next-line no-console -- global safety net logs for debugging
  console.error('[global] Unhandled promise rejection:', e.reason)
})
window.addEventListener('error', (e) => {
  // eslint-disable-next-line no-console -- global safety net logs for debugging
  console.error('[global] Uncaught error:', e.error ?? e.message)
})

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')

createRoot(rootEl).render(
  <ErrorBoundary>
    <RouterProvider router={router} />
  </ErrorBoundary>
)
