import { createBrowserRouter, Navigate } from 'react-router'
import { Shell } from '@/components/layout/Shell'
import { SetupPage } from '@/pages/SetupPage'
import { ControllerPage } from '@/pages/ControllerPage'
import { TallyPage } from '@/pages/TallyPage'
import { ProductionsPage } from '@/pages/ProductionsPage'
import { PanePage } from '@/pages/PanePage'

export const router = createBrowserRouter([
  {
    // Standalone pages — no Shell, no nav
    path: '/tally',
    element: <TallyPage />,
  },
  {
    path: '/pane/:pane',
    element: <PanePage />,
  },
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/productions" replace /> },
      { path: 'productions', element: <ProductionsPage /> },
      { path: 'setup/*', element: <SetupPage /> },
      { path: 'studio', element: <ControllerPage /> },
    ],
  },
])
