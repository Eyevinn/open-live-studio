/**
 * WebRTC utilities for the viewer.
 * No signaling server in mock mode — uses getUserMedia or canvas color bars.
 * See docs/repo-patterns.md: "WebRTC viewer fails on mobile without TURN"
 */

// ---------------------------------------------------------------------------
// WhepClient — WHEP viewer connection
// Ported from strom/backend/static/whep/whep.js.
// ---------------------------------------------------------------------------

type WhepCallbacks = {
  onVideoTrack?: (stream: MediaStream) => void
  onConnected?: () => void
  onDisconnected?: () => void
  onError?: (msg: string) => void
}

type WhepOptions = {
  /** Override the ICE servers URL. Defaults to {endpoint origin}/api/ice-servers.
   *  Use the backend proxy URL to avoid CORS/auth issues with remote Strom instances. */
  iceServersUrl?: string
  /** Proxy URL for WHEP SDP signaling. When set, POST/DELETE go to
   *  {proxyUrl}?target={encodeURIComponent(stromUrl)} instead of Strom directly. */
  proxyUrl?: string
}

export class WhepClient {
  private pc: RTCPeerConnection | null = null
  private resourceUrl: string | null = null
  private healthInterval: ReturnType<typeof setInterval> | null = null
  private prevFramesDecoded = 0
  private prevPacketsLost = 0
  private frozenSince = 0
  private lossRecoveryPending = false

  constructor(
    private readonly endpoint: string,
    private readonly callbacks: WhepCallbacks = {},
    private readonly options: WhepOptions = {},
  ) {}

  async connect(): Promise<boolean> {
    try {
      // Fetch ICE config. Use the provided iceServersUrl (backend proxy) or fall
      // back to the endpoint's origin — the proxy avoids CORS/auth issues with
      // remote Strom instances.
      const iceUrl = this.options.iceServersUrl ?? `${new URL(this.endpoint).origin}/api/ice-servers`
      let iceServers: RTCIceServer[] = []
      let iceTransportPolicy: RTCIceTransportPolicy = 'all'
      try {
        const resp = await fetch(iceUrl)
        if (resp.ok) {
          // Backend proxy returns { iceServers }; Strom directly returns { ice_servers }
          const cfg = await resp.json() as { iceServers?: RTCIceServer[]; ice_servers?: RTCIceServer[]; ice_transport_policy?: string }
          const servers = cfg.iceServers ?? cfg.ice_servers
          if (servers?.length) iceServers = servers
          if (cfg.ice_transport_policy) iceTransportPolicy = cfg.ice_transport_policy as RTCIceTransportPolicy
        }
      } catch { /* use browser defaults */ }

      this.pc = new RTCPeerConnection({ iceServers, iceTransportPolicy })

      const remoteStream = new MediaStream()
      this.pc.ontrack = (event) => {
        remoteStream.addTrack(event.track)
        if (event.track.kind === 'video') {
          this.callbacks.onVideoTrack?.(remoteStream)
        }
      }

      this.pc.oniceconnectionstatechange = () => {
        const state = this.pc?.iceConnectionState
        console.log('[WhepClient] ICE state:', state)
        if (state === 'connected' || state === 'completed') {
          this.callbacks.onConnected?.()
          this._startHealthMonitor()
        } else if (state === 'failed') {
          this.callbacks.onError?.('ICE connection failed — check TURN server')
        } else if (state === 'disconnected') {
          this.callbacks.onDisconnected?.()
        }
      }

      this.pc.onicecandidateerror = (e) => {
        console.warn('[WhepClient] ICE candidate error:', e.errorCode, e.errorText, e.url)
      }

      this.pc.onicecandidate = (e) => {
        if (e.candidate) {
          console.log('[WhepClient] Local candidate:', e.candidate.type, e.candidate.protocol, e.candidate.address)
        } else {
          console.log('[WhepClient] ICE gathering complete')
        }
      }

      // recvonly transceivers — server decides what to send
      this.pc.addTransceiver('audio', { direction: 'recvonly' })
      this.pc.addTransceiver('video', { direction: 'recvonly' })

      const offer = await this.pc.createOffer()
      // Enable Opus stereo locally — Chrome defaults to mono
      offer.sdp = this._enableOpusStereo(offer.sdp ?? '')
      await this.pc.setLocalDescription(offer)

      // Wait for ICE gathering (2 s timeout)
      await new Promise<void>((resolve) => {
        if (this.pc?.iceGatheringState === 'complete') { resolve(); return }
        const timer = setTimeout(resolve, 2000)
        this.pc!.onicegatheringstatechange = () => {
          if (this.pc?.iceGatheringState === 'complete') { clearTimeout(timer); resolve() }
        }
      })

      // Strip Opus stereo params before sending — webrtcsink capsfilter rejects them
      const serverSdp = this._stripOpusStereoForServer(this.pc.localDescription!.sdp)
      const postUrl = this.options.proxyUrl
        ? `${this.options.proxyUrl}?target=${encodeURIComponent(this.endpoint)}`
        : this.endpoint
      const resp = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: serverSdp,
      })
      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`WHEP ${resp.status}: ${text}`)
      }

      this.resourceUrl = resp.headers.get('Location')
      const answerSdp = await resp.text()
      // Log Strom's ICE candidates from the answer for diagnostics
      answerSdp.split('\r\n').filter(l => l.startsWith('a=candidate')).forEach(l => console.log('[WhepClient] Remote candidate:', l))
      await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
      return true
    } catch (err) {
      this.callbacks.onError?.((err as Error).message)
      this.close()
      return false
    }
  }

  async disconnect(): Promise<void> {
    if (this.resourceUrl) {
      try { await fetch(this.resourceUrl, { method: 'DELETE' }) } catch { /* ignore */ }
    }
    this.close()
    this.callbacks.onDisconnected?.()
  }

  close(): void {
    if (this.healthInterval) { clearInterval(this.healthInterval); this.healthInterval = null }
    this.pc?.close()
    this.pc = null
    this.resourceUrl = null
  }

  isConnected(): boolean {
    const s = this.pc?.iceConnectionState
    return s === 'connected' || s === 'completed'
  }

  // Enable stereo for Opus — Chrome defaults to mono (stereo=0)
  private _enableOpusStereo(sdp: string): string {
    const match = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i)
    if (!match) return sdp
    const pt = match[1]
    return sdp.replace(new RegExp(`(a=fmtp:${pt} [^\r\n]+)`, 'g'), (m) =>
      m.includes('stereo=') ? m : `${m};stereo=1;sprop-stereo=1`
    )
  }

  // Strip stereo params before sending to server — webrtcsink codec discovery rejects them
  private _stripOpusStereoForServer(sdp: string): string {
    return sdp.replace(/;stereo=1/g, '').replace(/;sprop-stereo=1/g, '')
  }

  // Detect video freeze after packet loss and recover by re-attaching the stream
  private _startHealthMonitor(): void {
    if (this.healthInterval) return
    this.prevFramesDecoded = 0
    this.prevPacketsLost = 0
    this.frozenSince = 0
    this.lossRecoveryPending = false

    this.healthInterval = setInterval(() => {
      if (!this.isConnected()) return
      void this.pc!.getStats().then((stats) => {
        let framesDecoded = 0, packetsLost = 0
        stats.forEach((r) => {
          if (r.type === 'inbound-rtp' && (r as RTCInboundRtpStreamStats & { kind?: string }).kind === 'video') {
            framesDecoded = (r as RTCInboundRtpStreamStats).framesDecoded ?? 0
            packetsLost = (r as RTCInboundRtpStreamStats).packetsLost ?? 0
          }
        })

        const newLoss = packetsLost - this.prevPacketsLost
        const newFrames = framesDecoded - this.prevFramesDecoded
        if (newLoss > 0 && this.prevPacketsLost > 0) this.lossRecoveryPending = true

        const now = Date.now()
        if (this.prevFramesDecoded > 0 && newFrames === 0) {
          if (!this.frozenSince) this.frozenSince = now
        } else {
          if (this.lossRecoveryPending && newFrames > 0) this.lossRecoveryPending = false
          this.frozenSince = 0
        }

        if (this.frozenSince && this.lossRecoveryPending && now - this.frozenSince > 3000) {
          this._recoverVideo()
          this.frozenSince = 0
          this.lossRecoveryPending = false
        }

        this.prevFramesDecoded = framesDecoded
        this.prevPacketsLost = packetsLost
      }).catch(() => { /* PC closing */ })
    }, 1000)
  }

  // Re-attach video track to force decoder reset + PLI keyframe request
  private _recoverVideo(): void {
    if (!this.pc) return
    for (const receiver of this.pc.getReceivers()) {
      if (receiver.track?.kind === 'video') {
        this.callbacks.onVideoTrack?.(new MediaStream([receiver.track]))
        break
      }
    }
  }
}

/**
 * SMPTE-style color bar test signal via Canvas API.
 * Used as fallback when camera is unavailable.
 */
export function createColorBarStream(): MediaStream {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')!

  const bars = [
    '#c0c0c0', // White
    '#c0c000', // Yellow
    '#00c0c0', // Cyan
    '#00c000', // Green
    '#c000c0', // Magenta
    '#c00000', // Red
    '#0000c0', // Blue
    '#000000', // Black
  ]

  let frame = 0

  function draw() {
    const barWidth = canvas.width / bars.length
    bars.forEach((color, i) => {
      ctx.fillStyle = color
      ctx.fillRect(i * barWidth, 0, barWidth, canvas.height * 0.75)
    })

    // Bottom sub-bars
    ctx.fillStyle = '#00008B'
    ctx.fillRect(0, canvas.height * 0.75, canvas.width * 0.125, canvas.height * 0.25)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(canvas.width * 0.125, canvas.height * 0.75, canvas.width * 0.125, canvas.height * 0.25)
    ctx.fillStyle = '#1a1a6e'
    ctx.fillRect(canvas.width * 0.25, canvas.height * 0.75, canvas.width * 0.5, canvas.height * 0.25)
    ctx.fillStyle = '#000000'
    ctx.fillRect(canvas.width * 0.75, canvas.height * 0.75, canvas.width * 0.25, canvas.height * 0.25)

    // Frame counter overlay
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(8, 8, 220, 28)
    ctx.fillStyle = '#00ff00'
    ctx.font = 'bold 14px monospace'
    ctx.fillText(`OPEN LIVE — TEST SIGNAL  ${String(frame).padStart(6, '0')}`, 12, 26)
    frame++
  }

  draw()
  const interval = setInterval(draw, 1000 / 30)

  const stream = canvas.captureStream(30)

  // Clean up interval when stream ends
  stream.getTracks().forEach((t) => {
    t.addEventListener('ended', () => clearInterval(interval))
  })

  return stream
}

/**
 * Acquires a canvas mock stream for a source tile. Never accesses the camera —
 * real video comes from WHEP streams, not getUserMedia.
 */
export function getSourceStream(source: { color: string; name: string }): Promise<MediaStream> {
  return Promise.resolve(createSourceStream(source.color, source.name))
}

/**
 * Creates a colored canvas stream for a multiview cell (simulates a source feed).
 */
export function createSourceStream(color: string, label: string): MediaStream {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const ctx = canvas.getContext('2d')!

  function draw() {
    ctx.fillStyle = color
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 1
    for (let x = 0; x < canvas.width; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke()
    }
    for (let y = 0; y < canvas.height; y += 36) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke()
    }

    // Label
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(0, canvas.height / 2 - 20, canvas.width, 40)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 18px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 6)
    ctx.textAlign = 'left'

    // Timecode
    const now = new Date()
    const tc = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}:00`
    ctx.font = '12px monospace'
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText(tc, 8, canvas.height - 8)
  }

  draw()
  const interval = setInterval(draw, 1000)
  const stream = canvas.captureStream(10)
  stream.getTracks().forEach((t) => {
    t.addEventListener('ended', () => clearInterval(interval))
  })
  return stream
}
