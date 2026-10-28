import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useIntercomStore } from '@/store/intercom.store'
import { useIntercomAudio } from '@/hooks/useIntercomAudio'
import { TalkbackManager, type TalkbackSnapshot } from '@/lib/talkback-manager'

export interface GuestTalkbackControls {
  snapshot: TalkbackSnapshot
  manager: TalkbackManager
}

/**
 * Wires the per-guest `TalkbackManager` (studio#237) to the Guests panel:
 *   - the shared mic comes from `useIntercomAudio` and is held only while some
 *     guest's talkback is connecting/open (released when none is);
 *   - a mic-device change re-acquires the stream, which the manager swaps onto
 *     every open WHIP sender; the output device goes to `setSinkId`;
 *   - window `blur` / `visibilitychange` → hidden end a held push-to-talk;
 *   - teardown: a guest gone from `liveGuestIds` (`GUEST_STATE` left), the
 *     production going inactive, a production change, or unmount closes the
 *     affected sessions (both crew DELETEs + both PCs).
 */
export function useGuestTalkback(
  productionId: string,
  productionActive: boolean,
  liveGuestIds: readonly string[],
): GuestTalkbackControls {
  useIntercomAudio()
  const manager = useMemo(() => new TalkbackManager({ productionId }), [productionId])
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot)

  const localStream = useIntercomStore((s) => s.localStream)
  const micActive = useIntercomStore((s) => s.micActive)
  const setMicActive = useIntercomStore((s) => s.setMicActive)
  const outputDeviceId = useIntercomStore((s) => s.outputDeviceId)

  // Unmount / production change: close everything on the old manager.
  useEffect(() => () => { void manager.closeAll() }, [manager])

  useEffect(() => { manager.setMicStream(localStream) }, [manager, localStream])
  useEffect(() => { manager.setSinkId(outputDeviceId) }, [manager, outputDeviceId])

  // The mic is requested only while talkback needs it. If acquisition fails,
  // `useIntercomAudio` flips `micActive` back off: fail every guest that is
  // waiting for or holding a clone of the mic (also a failed re-acquire after a
  // picker change), which clears `wantsMic` so the next Open/Retry asks again.
  // (Declared before the request effect so it never sees its own request's
  // not-yet-applied `micActive`.)
  const micRequested = useRef(false)
  useEffect(() => {
    if (!micActive && micRequested.current && manager.wantsMic()) manager.micFailed()
  }, [micActive, manager])
  const wantsMic = Object.values(snapshot).some((v) => v.status !== 'unavailable')
  useEffect(() => {
    if (wantsMic === micRequested.current) return
    micRequested.current = wantsMic
    setMicActive(wantsMic)
  }, [wantsMic, setMicActive])
  useEffect(() => () => {
    if (micRequested.current) {
      micRequested.current = false
      setMicActive(false)
    }
  }, [setMicActive])

  useEffect(() => {
    if (!productionActive) void manager.closeAll()
  }, [productionActive, manager])

  const liveKey = [...liveGuestIds].sort().join('\n')
  useEffect(() => {
    manager.retainOnly(liveKey ? liveKey.split('\n') : [])
  }, [liveKey, manager])

  // A held Talk press must never outlive focus (stuck key → control room in the guest's ear).
  useEffect(() => {
    const onBlur = () => manager.cancelHold()
    const onVisibility = () => { if (document.visibilityState === 'hidden') manager.cancelHold() }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [manager])

  return { snapshot, manager }
}
