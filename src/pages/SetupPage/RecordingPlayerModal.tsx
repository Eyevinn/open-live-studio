import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import type { ApiRecording } from '@/lib/api'
import {
  classifyPlaybackError,
  isMixedContent,
  isPresignExpired,
  playbackErrorMessage,
  playbackUnavailableMessage,
  probePlaybackUrl,
  recordingFileName,
  recordingsErrorMessage,
} from '@/lib/recordings'
import { useRecordingsStore } from '@/store/recordings.store'

type PlayerState =
  | { phase: 'loading' }
  | { phase: 'fetch-error'; message: string }
  | { phase: 'unavailable'; message: string }
  | { phase: 'ready'; url: string }
  | { phase: 'checking'; url: string }
  | { phase: 'media-error'; message: string }

interface Props {
  recording: ApiRecording
  title: string
  onClose: () => void
}

/**
 * Plays one recording. It never uses the URL from the list: each open (and
 * each "Reload link") fetches `GET /api/v1/recordings/:id` for a freshly signed
 * `playbackUrl`, because the listed one expires after `RECORDING_PRESIGN_TTL_S`.
 */
export function RecordingPlayerModal({ recording, title, onClose }: Props) {
  const fetchFresh = useRecordingsStore((s) => s.fetchFresh)
  const [state, setState] = useState<PlayerState>({ phase: 'loading' })
  // Guards against a slow fetch/probe resolving after a newer reload or close.
  const attempt = useRef(0)

  const load = useCallback(async () => {
    const n = ++attempt.current
    setState({ phase: 'loading' })
    try {
      const fresh = await fetchFresh(recording.id)
      if (n !== attempt.current) return
      setState(fresh.playbackUrl
        ? { phase: 'ready', url: fresh.playbackUrl }
        : { phase: 'unavailable', message: playbackUnavailableMessage(fresh) })
    } catch (err) {
      if (n !== attempt.current) return
      setState({ phase: 'fetch-error', message: recordingsErrorMessage(err) })
    }
  }, [fetchFresh, recording.id])

  useEffect(() => {
    void load()
    return () => { attempt.current += 1 }
  }, [load])

  async function handleVideoError(e: SyntheticEvent<HTMLVideoElement>) {
    if (state.phase !== 'ready') return
    const url = state.url
    const mediaErrorCode = e.currentTarget.error?.code
    const n = attempt.current
    setState({ phase: 'checking', url })
    const protocol = window.location.protocol
    const expired = isPresignExpired(url)
    const mixedContent = isMixedContent(url, protocol)
    const probe = expired || mixedContent ? { kind: 'reachable' as const } : await probePlaybackUrl(url)
    if (n !== attempt.current) return
    const kind = classifyPlaybackError({ expired, mixedContent, probe, mediaErrorCode })
    setState({ phase: 'media-error', message: playbackErrorMessage(kind, protocol) })
  }

  return (
    <Modal open title={title} onClose={onClose} className="max-w-3xl">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-mono text-[--color-text-muted] break-all">{recordingFileName(recording.key)}</p>

        {state.phase === 'loading' && (
          <p className="text-sm text-[--color-text-muted]">Fetching a playback link…</p>
        )}

        {(state.phase === 'ready' || state.phase === 'checking') && (
          <video
            key={state.url}
            src={state.url}
            controls
            autoPlay
            playsInline
            preload="metadata"
            onError={(e) => void handleVideoError(e)}
            className="w-full max-h-[60vh] bg-black rounded"
          />
        )}
        {state.phase === 'checking' && (
          <p className="text-xs text-[--color-text-muted]">Playback failed. Checking why…</p>
        )}

        {state.phase === 'unavailable' && (
          <p className="text-sm text-[--color-text-muted]">{state.message}</p>
        )}

        {(state.phase === 'fetch-error' || state.phase === 'media-error') && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded border border-red-900 bg-red-950/40 px-3 py-2">
            <p className="text-sm text-red-300">{state.message}</p>
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              {state.phase === 'media-error' ? 'Reload link' : 'Retry'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
