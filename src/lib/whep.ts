/**
 * WHEP (WebRTC-HTTP Egress Protocol) client.
 *
 * Connects to a WHEP endpoint and returns a MediaStream containing the
 * video and audio tracks from the remote sender.
 *
 * See spec: docs/specs/activation-whep.md §5
 * See CLAUDE.md: "never polyfill the media layer" — standard RTCPeerConnection only
 * See docs/repo-patterns.md: "Safari requires playsinline autoplay muted"
 */

const WHEP_ICE_TIMEOUT_MS = 15000

export async function connectWhep(
  whepUrl: string,
  iceServers: RTCIceServer[],
): Promise<{ stream: MediaStream; close: () => void }> {
  const pc = new RTCPeerConnection({ iceServers })
  let whepResourceUrl: string | null = null

  // Add recvonly transceivers so the offer includes a/v m-lines
  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })

  // Assign ontrack BEFORE setLocalDescription/setRemoteDescription.
  // In Chromium and Safari, ontrack events can fire synchronously during
  // setRemoteDescription processing — assigning the handler late silently
  // drops those tracks, leaving the viewer black.
  const stream = new MediaStream()
  pc.ontrack = (event) => {
    const incomingStream = event.streams[0] ?? new MediaStream([event.track])
    incomingStream.getTracks().forEach((t) => {
      if (!stream.getTracks().includes(t)) {
        stream.addTrack(t)
      }
    })
  }

  // Create offer and set as local description
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  // POST the offer SDP to the WHEP endpoint
  let response: Response
  try {
    response = await fetch(whepUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    })
  } catch (fetchErr) {
    pc.close()
    throw new Error(`WHEP: network error posting offer: ${String(fetchErr)}`)
  }

  if (response.status !== 201) {
    pc.close()
    throw new Error(`WHEP: unexpected status ${response.status} from ${whepUrl}`)
  }

  // Capture the teardown URL from the Location header
  const location = response.headers.get('Location')
  if (location) {
    // Resolve relative URLs against the WHEP endpoint origin
    try {
      whepResourceUrl = new URL(location, whepUrl).toString()
    } catch {
      whepResourceUrl = location
    }
  }

  const answerSdp = await response.text()
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

  // Wait for ICE to reach 'connected' state within the timeout
  await new Promise<void>((resolve, reject) => {
    // Already connected (fast-path for localhost / relay-less paths)
    if (
      pc.iceConnectionState === 'connected' ||
      pc.iceConnectionState === 'completed'
    ) {
      resolve()
      return
    }

    const timer = setTimeout(() => {
      reject(new Error(`WHEP: ICE connection timed out after ${WHEP_ICE_TIMEOUT_MS}ms`))
    }, WHEP_ICE_TIMEOUT_MS)

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState
      if (s === 'connected' || s === 'completed') {
        clearTimeout(timer)
        resolve()
      } else if (s === 'failed' || s === 'closed') {
        clearTimeout(timer)
        reject(new Error(`WHEP: ICE connection failed (state: ${s})`))
      }
    }
  }).catch((err: unknown) => {
    // Clean up and re-throw so the caller can fall back to mock stream
    pc.close()
    stream.getTracks().forEach((t) => t.stop())
    throw err
  })

  function close(): void {
    pc.close()
    stream.getTracks().forEach((t) => t.stop())

    // Best-effort DELETE to release the WHEP server-side session
    if (whepResourceUrl) {
      fetch(whepResourceUrl, { method: 'DELETE' }).catch((err: unknown) => {
        console.warn('[whep] DELETE resource failed (best-effort):', err)
      })
    }
  }

  return { stream, close }
}
