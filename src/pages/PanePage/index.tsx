import { useEffect, useCallback, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { useWebRTC } from '@/hooks/useWebRTC'
import { useControllerWs } from '@/hooks/useControllerWs'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'
import { useSourcesStore } from '@/store/sources.store'
import { useTemplatesStore } from '@/store/templates.store'
import { useGraphicsStore } from '@/store/graphics.store'
import { useOutputsStore } from '@/store/outputs.store'
import { useAudioStore } from '@/store/audio.store'
import { useViewerStore } from '@/store/viewer.store'
import { audioApi } from '@/lib/api'
import { ProgramPreview } from '@/pages/ControllerPage/ProgramPreview'
import { TransitionPanel } from '@/pages/ControllerPage/TransitionPanel'
import { DskPanel } from '@/pages/ControllerPage/DskPanel'
import { AudioPanel } from '@/pages/ControllerPage/AudioPanel'

type Pane = 'multiviewer' | 'controller' | 'audio' | 'pgm'

// ─── PGM confidence monitor ───────────────────────────────────────────────────

interface PgmChannel { label: string; url: string }

// Labels for the two audio tracks wired by flow-generator: track 0 = programme mix,
// track 1 = monitor/PFL bus.

// AudioPanel's natural rendered height when populated (header + FADER_CONTAINER_H + readout + buttons).
// Used to compute the zoom factor that fills the viewport height.
const AUDIO_PANEL_NATURAL_H = 300

function AudioPaneFullscreen({ send }: { send: ReturnType<typeof useControllerWs> }) {
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const compute = () => setZoom(Math.max(1, window.innerHeight / AUDIO_PANEL_NATURAL_H))
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  return (
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
      {/* height inverse of zoom so the panel fills exactly one screen height after scaling */}
      <div style={{ zoom, height: `${100 / zoom}%` }}>
        <AudioPanel send={send} />
      </div>
    </div>
  )
}

export function PanePage() {
  const { pane } = useParams<{ pane: Pane }>()
  const [searchParams] = useSearchParams()
  const productionId = searchParams.get('production')

  // No Shell in this route — bootstrap all store data ourselves
  const fetchProductions = useProductionsStore((s) => s.fetchAll)
  const fetchSources     = useSourcesStore((s) => s.fetchAll)
  const fetchTemplates   = useTemplatesStore((s) => s.fetchAll)
  const fetchGraphics    = useGraphicsStore((s) => s.fetchAll)
  const fetchOutputs     = useOutputsStore((s) => s.fetchAll)

  useEffect(() => {
    void fetchTemplates()
    void fetchGraphics()
    void fetchOutputs()
  }, [fetchTemplates, fetchGraphics, fetchOutputs])

  useEffect(() => {
    void fetchSources()
    void fetchProductions()
    const id = setInterval(() => { void fetchSources(); void fetchProductions() }, 5000)
    return () => clearInterval(id)
  }, [fetchSources, fetchProductions])

  const { cut, auto, ftb, setPvw, pvwInput, transitionType, transitionDurationMs, setActiveProduction } = useProductionStore()
  const activeProduction   = useProductionsStore((s) => s.productions.find((p) => p.id === productionId))
  const whepEndpoint       = useProductionsStore((s) => s.productions.find((p) => p.id === productionId)?.whepEndpoint)
  const pgmWhepEndpoint    = useProductionsStore((s) => s.productions.find((p) => p.id === productionId)?.pgmWhepEndpoint)
  const whepOutputUrls     = useProductionsStore((s) => s.productions.find((p) => p.id === productionId)?.whepOutputUrls)
  const outputs            = useOutputsStore((s) => s.outputs)

  // Build the ordered channel list: PGM first, then named WHEP outputs.
  const pgmChannels: PgmChannel[] = [
    ...(pgmWhepEndpoint ? [{ label: 'PGM', url: pgmWhepEndpoint }] : []),
    ...(whepOutputUrls ?? []).map(({ outputId, url }) => ({
      label: outputs.find((o) => o.id === outputId)?.name ?? 'Output',
      url,
    })),
  ]

  const [selectedPgmUrl, setSelectedPgmUrl] = useState<string | undefined>(undefined)
  const [selectedMvUrl, setSelectedMvUrl] = useState<string | undefined>(undefined)
  const { audioTrackCount } = useViewerStore()
  const [mvAudioOn, setMvAudioOn] = useState(false)
  const [mvAudioTrack, setMvAudioTrack] = useState(1)
  const [pgmAudioOn, setPgmAudioOn] = useState(false)
  const [pgmAudioTrack, setPgmAudioTrack] = useState(0)

  // Default PGM pane to first channel when channels first become available.
  useEffect(() => {
    if (!selectedPgmUrl && pgmChannels.length > 0) setSelectedPgmUrl(pgmChannels[0]!.url)
  }, [pgmChannels.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (productionId) setActiveProduction(productionId)
  }, [productionId, setActiveProduction])

  useWebRTC(
    pane === 'multiviewer' ? (selectedMvUrl ?? whepEndpoint ?? null) :
    pane === 'pgm'         ? (selectedPgmUrl ?? pgmWhepEndpoint ?? null) :
    null
  )
  const send = useControllerWs(pane !== 'multiviewer' ? productionId : null)

  const setElements = useAudioStore((s) => s.setElements)
  useEffect(() => {
    if (!productionId) return
    setElements([], productionId)
    if (activeProduction?.status !== 'active') return
    let cancelled = false
    void audioApi.discoverElements(productionId).then((elements) => {
      if (!cancelled) setElements(elements, productionId)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [productionId, activeProduction?.status, setElements])

  const handleCut       = useCallback(() => { cut(); send({ type: 'CUT', mixerInput: pvwInput ?? '' }) }, [cut, send, pvwInput])
  const handleAuto      = useCallback(() => { auto(); send({ type: 'TRANSITION', mixerInput: pvwInput ?? '', transitionType, durationMs: transitionDurationMs }) }, [auto, send, pvwInput, transitionType, transitionDurationMs])
  const handleFtb       = useCallback(() => { ftb(); send({ type: 'FTB', durationMs: transitionDurationMs }) }, [ftb, send, transitionDurationMs])
  const handleSetOvl    = useCallback((alpha: number) => { send({ type: 'SET_OVL', alpha }) }, [send])
  const handleSelectPvw = useCallback((mixerInput: string) => { setPvw(mixerInput); send({ type: 'SET_PVW', mixerInput }) }, [setPvw, send])
  const handleDskToggle = (layer: number, visible: boolean) => { send({ type: 'DSK_TOGGLE', layer, visible }) }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (pane !== 'controller') return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.code === 'Space') { e.preventDefault(); handleCut() }
    if (e.code === 'Enter') { e.preventDefault(); handleAuto() }
  }, [pane, handleCut, handleAuto])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="h-screen w-screen bg-[--color-surface-1] overflow-hidden flex flex-col">
      {pane === 'multiviewer' && (
        <div className="flex-1 min-h-0 flex flex-col p-2 gap-1.5">
          {(pgmChannels.length > 1 || audioTrackCount > 0) && (
            <div className="flex items-center gap-1.5 shrink-0">
              {pgmChannels.map((ch) => {
                const active = ch.url === (selectedMvUrl ?? pgmChannels[0]?.url)
                return (
                  <button
                    key={ch.url}
                    onClick={() => setSelectedMvUrl(ch.url)}
                    className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest cursor-pointer transition-colors border"
                    style={{
                      background: active ? '#f97316' : 'transparent',
                      borderColor: active ? '#f97316' : '#3f3f46',
                      color: active ? '#000' : '#a1a1aa',
                    }}
                  >
                    {ch.label}
                  </button>
                )
              })}
              {audioTrackCount > 0 && (
                <>
                  <button
                    onClick={() => setMvAudioOn(v => !v)}
                    className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest cursor-pointer transition-colors border"
                    style={{
                      background: mvAudioOn ? '#18181b' : 'transparent',
                      borderColor: mvAudioOn ? '#f97316' : '#3f3f46',
                      color: mvAudioOn ? '#f97316' : '#52525b',
                    }}
                  >♪</button>
                  {audioTrackCount > 1 && (
                    <select
                      value={mvAudioTrack}
                      onChange={(e) => setMvAudioTrack(parseInt(e.target.value, 10))}
                      className="text-[9px] font-bold uppercase tracking-widest cursor-pointer bg-zinc-900 border border-zinc-700 text-zinc-400 px-1 py-0.5 focus:outline-none focus:border-orange-500"
                    >
                      {(['PGM', 'MON'] as const).slice(0, audioTrackCount).map((label, i) => (
                        <option key={i} value={i}>{label}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
          )}
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <ProgramPreview
              audioOn={mvAudioOn}
              onAudioOnChange={setMvAudioOn}
              audioTrack={mvAudioTrack}
              onAudioTrackChange={setMvAudioTrack}
            />
          </div>
        </div>
      )}
      {pane === 'controller' && (
        <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
          <TransitionPanel
            onCut={handleCut}
            onAuto={handleAuto}
            onFtb={handleFtb}
            onSelectPvw={handleSelectPvw}
            onSetOvl={handleSetOvl}
          />
          <DskPanel onToggle={handleDskToggle} />
        </div>
      )}
      {pane === 'audio' && (
        <AudioPaneFullscreen send={send} />
      )}
      {pane === 'pgm' && (
        <div className="flex-1 min-h-0 flex flex-col p-2 gap-1.5">
          {(pgmChannels.length > 1 || audioTrackCount > 0) && (
            <div className="flex items-center gap-1.5 shrink-0">
              {pgmChannels.map((ch) => {
                const active = ch.url === (selectedPgmUrl ?? pgmChannels[0]?.url)
                return (
                  <button
                    key={ch.url}
                    onClick={() => setSelectedPgmUrl(ch.url)}
                    className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest cursor-pointer transition-colors border"
                    style={{
                      background: active ? '#f97316' : 'transparent',
                      borderColor: active ? '#f97316' : '#3f3f46',
                      color: active ? '#000' : '#a1a1aa',
                    }}
                  >
                    {ch.label}
                  </button>
                )
              })}
              {audioTrackCount > 0 && (
                <>
                  <button
                    onClick={() => setPgmAudioOn(v => !v)}
                    className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest cursor-pointer transition-colors border"
                    style={{
                      background: pgmAudioOn ? '#18181b' : 'transparent',
                      borderColor: pgmAudioOn ? '#f97316' : '#3f3f46',
                      color: pgmAudioOn ? '#f97316' : '#52525b',
                    }}
                  >♪</button>
                  {audioTrackCount > 1 && (
                    <select
                      value={pgmAudioTrack}
                      onChange={(e) => setPgmAudioTrack(parseInt(e.target.value, 10))}
                      className="text-[9px] font-bold uppercase tracking-widest cursor-pointer bg-zinc-900 border border-zinc-700 text-zinc-400 px-1 py-0.5 focus:outline-none focus:border-orange-500"
                    >
                      {(['Main', 'MON'] as const).slice(0, audioTrackCount).map((label, i) => (
                        <option key={i} value={i}>{label}</option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
          )}
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <ProgramPreview
              noSignal={activeProduction?.status !== 'active'}
              audioOn={pgmAudioOn}
              onAudioOnChange={setPgmAudioOn}
              audioTrack={pgmAudioTrack}
              onAudioTrackChange={setPgmAudioTrack}
            />
          </div>
        </div>
      )}
    </div>
  )
}
