import { useEffect, useRef } from 'react'
import { useIntercomStore } from '@/store/intercom.store'
import { INTERCOM_AUDIO_CONSTRAINTS } from '@/lib/audio-constraints'

/**
 * Manages mic acquisition and audio device enumeration for intercom.
 * See docs/repo-patterns.md: "Echo cancellation must be explicitly requested"
 */
export function useIntercomAudio() {
  const { micActive, micDeviceId, localStream, setLocalStream, setAvailableDevices, setAvailableOutputDevices, setMicActive } = useIntercomStore()
  const streamRef = useRef<MediaStream | null>(null)

  // Enumerate audio devices — on mount, on hot-plug, and again once the mic is
  // granted (device labels are empty until the first getUserMedia succeeds).
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices) return
    const enumerate = () => {
      void md.enumerateDevices().then((devices) => {
        setAvailableDevices(devices.filter((d) => d.kind === 'audioinput'))
        setAvailableOutputDevices(devices.filter((d) => d.kind === 'audiooutput'))
      }).catch(() => {})
    }
    enumerate()
    md.addEventListener?.('devicechange', enumerate)
    return () => md.removeEventListener?.('devicechange', enumerate)
  }, [setAvailableDevices, setAvailableOutputDevices, localStream])

  // Acquire or release mic stream
  useEffect(() => {
    if (!micActive) {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setLocalStream(null)
      return
    }

    const constraints: MediaStreamConstraints = {
      audio: micDeviceId
        ? { ...INTERCOM_AUDIO_CONSTRAINTS, deviceId: { exact: micDeviceId } }
        : INTERCOM_AUDIO_CONSTRAINTS,
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      // No media layer (insecure context / unsupported browser).
      setMicActive(false)
      return
    }
    let cancelled = false
    void navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      // Released (or the device changed) while the prompt was open: drop it.
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      setLocalStream(stream)
    }).catch(() => {
      if (!cancelled) setMicActive(false)
    })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setLocalStream(null)
    }
  }, [micActive, micDeviceId, setLocalStream, setMicActive])
}
