import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export type ViewerConnectionState = 'disconnected' | 'connecting' | 'connected' | 'mock' | 'error'

interface ViewerState {
  programStream: MediaStream | null
  connectionState: ViewerConnectionState
  isMockStream: boolean
  isMuted: boolean
  retryCountdown: number | null
  audioTrackCount: number
}

interface ViewerActions {
  setProgramStream: (stream: MediaStream | null, isMock: boolean) => void
  setConnectionState: (state: ViewerConnectionState) => void
  setRetryCountdown: (n: number | null) => void
  setMuted: (muted: boolean) => void
  setAudioTrackCount: (n: number) => void
  disconnect: () => void
}

export const useViewerStore = create<ViewerState & ViewerActions>()(
  devtools(
    (set, get) => ({
      programStream: null,
      connectionState: 'disconnected',
      isMockStream: false,
      isMuted: true,
      retryCountdown: null,
      audioTrackCount: 0,

      setProgramStream: (stream, isMock) =>
        set({
          programStream: stream,
          isMockStream: isMock,
          connectionState: stream ? (isMock ? 'mock' : 'connected') : 'disconnected',
          audioTrackCount: stream ? stream.getAudioTracks().length : 0,
        }),

      setConnectionState: (connectionState) => set({ connectionState }),

      setRetryCountdown: (retryCountdown) => set({ retryCountdown }),

      setMuted: (muted) => set({ isMuted: muted }),

      setAudioTrackCount: (audioTrackCount) => set({ audioTrackCount }),

      disconnect: () => {
        const { programStream } = get()
        if (programStream) programStream.getTracks().forEach((t) => t.stop())
        set({ programStream: null, connectionState: 'disconnected', isMockStream: false, audioTrackCount: 0 })
      },
    }),
    { name: 'viewer' },
  ),
)
