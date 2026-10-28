import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export interface IntercomLine {
  id: string
  name: string
  color: string
  description: string
}

interface IntercomState {
  lines: IntercomLine[]
  joinedLineIds: string[]
  micActive: boolean
  micMuted: boolean
  micDeviceId: string | null
  localStream: MediaStream | null
  availableDevices: MediaDeviceInfo[]
  /** Output device for talkback/intercom audio (`setSinkId`); null = system default. */
  outputDeviceId: string | null
  availableOutputDevices: MediaDeviceInfo[]
}

interface IntercomActions {
  joinLine: (id: string) => void
  leaveLine: (id: string) => void
  setMicActive: (active: boolean) => void
  setMicMuted: (muted: boolean) => void
  setMicDeviceId: (id: string | null) => void
  setLocalStream: (stream: MediaStream | null) => void
  setAvailableDevices: (devices: MediaDeviceInfo[]) => void
  setOutputDeviceId: (id: string | null) => void
  setAvailableOutputDevices: (devices: MediaDeviceInfo[]) => void
  isJoined: (id: string) => boolean
}

export const useIntercomStore = create<IntercomState & IntercomActions>()(
  devtools(
    (set, get) => ({
      lines: [],
      joinedLineIds: [],
      micActive: false,
      micMuted: false,
      micDeviceId: null,
      localStream: null,
      availableDevices: [],
      outputDeviceId: null,
      availableOutputDevices: [],

      joinLine: (id) => {
        const { joinedLineIds } = get()
        if (!joinedLineIds.includes(id)) set({ joinedLineIds: [...joinedLineIds, id] })
      },

      leaveLine: (id) =>
        set((state) => ({ joinedLineIds: state.joinedLineIds.filter((l) => l !== id) })),

      setMicActive: (micActive) => set({ micActive }),

      setMicMuted: (micMuted) => set({ micMuted }),

      setMicDeviceId: (micDeviceId) => set({ micDeviceId }),

      setLocalStream: (localStream) => set({ localStream }),

      setAvailableDevices: (availableDevices) => set({ availableDevices }),

      setOutputDeviceId: (outputDeviceId) => set({ outputDeviceId }),

      setAvailableOutputDevices: (availableOutputDevices) => set({ availableOutputDevices }),

      isJoined: (id) => get().joinedLineIds.includes(id),
    }),
    { name: 'intercom', enabled: import.meta.env.DEV },
  ),
)
