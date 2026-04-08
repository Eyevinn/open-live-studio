import { useEffect } from 'react'
import { useViewerStore } from '@/store/viewer.store'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { getViewerStream } from '@/lib/webrtc'
import { connectWhep } from '@/lib/whep'
import { iceServersApi } from '@/lib/api'

/**
 * Initialises the viewer stream on mount.
 *
 * When the active production has status 'active' and a whepEndpoint:
 *   - Fetches ICE servers from GET /api/v1/ice-servers (never hardcoded)
 *   - Connects via WHEP to the live multiview stream
 *   - On failure: falls back to color bars via getViewerStream()
 *
 * Otherwise: existing behavior (getUserMedia / color bars).
 *
 * Re-runs when whepEndpoint changes (e.g. activation completes).
 *
 * See spec: docs/specs/activation-whep.md §6.1
 * See docs/repo-patterns.md: "WebRTC viewer fails on mobile without TURN"
 * See docs/repo-patterns.md: "Safari requires playsinline autoplay muted"
 */
export function useWebRTC(): void {
  const setProgramStream = useViewerStore((s) => s.setProgramStream)
  const setConnectionState = useViewerStore((s) => s.setConnectionState)
  const disconnect = useViewerStore((s) => s.disconnect)

  const activeProductionId = useProductionStore((s) => s.activeProductionId)
  const productions = useProductionsStore((s) => s.productions)

  const activeProd = activeProductionId
    ? productions.find((p) => p.id === activeProductionId)
    : undefined

  const whepEndpoint =
    activeProd?.status === 'active' ? (activeProd.whepEndpoint ?? null) : null

  useEffect(() => {
    let cancelled = false
    let closeWhep: (() => void) | null = null
    setConnectionState('connecting')

    async function connect(): Promise<void> {
      if (whepEndpoint) {
        try {
          const { iceServers } = await iceServersApi.get()
          if (cancelled) return
          const { stream, close } = await connectWhep(whepEndpoint, iceServers)
          if (cancelled) {
            close()
            return
          }
          closeWhep = close
          setProgramStream(stream, false)
          return
        } catch (err) {
          console.warn('[useWebRTC] WHEP connection failed, falling back to mock stream:', err)
          if (cancelled) return
        }
      }

      // Fallback: getUserMedia or color bars
      const { stream, isMock } = await getViewerStream()
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      setProgramStream(stream, isMock)
    }

    void connect()

    return () => {
      cancelled = true
      if (closeWhep) {
        closeWhep()
        closeWhep = null
      }
      disconnect()
    }
    // Re-run when whepEndpoint changes (activation may complete while hook is mounted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whepEndpoint, setProgramStream, setConnectionState, disconnect])
}
