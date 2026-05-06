import { useEffect, useRef, useState, useCallback } from 'react'
import { BASE } from '@/lib/api'
import { authenticateWithOpenLive, getApiToken, isOnOsc } from '@/lib/sat'
import { useProgramStartMs, getProgramMode, COUNTDOWN_WINDOW_MS, PROGRAM_WINDOW_MS } from '@/store/programClock.store'
import { useProductionStore } from '@/store/production.store'
import { useProductionsStore } from '@/store/productions.store'

// ── Server time sync ──────────────────────────────────────────────────────────
async function fetchServerOffset(): Promise<number> {
  try {
    await authenticateWithOpenLive()
    const token = await getApiToken()
    const before = Date.now()
    const res = await fetch(`${BASE}/api/v1/ping`, {
      method: 'HEAD',
      cache: 'no-store',
      credentials: isOnOsc() ? 'include' : 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const after = Date.now()
    const serverDateStr = res.headers.get('Date')
    if (!serverDateStr) return 0
    return new Date(serverDateStr).getTime() - Math.round((before + after) / 2)
  } catch { return 0 }
}

// ── Timezone abbreviation ─────────────────────────────────────────────────────
function tzAbbr(): string {
  try {
    return new Intl.DateTimeFormat('en', { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value ?? 'LOCAL'
  } catch { return 'LOCAL' }
}

// ── Formatting ────────────────────────────────────────────────────────────────
function pad2(n: number) { return String(Math.floor(Math.abs(n))).padStart(2, '0') }
function formatHMS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

// ── Component ─────────────────────────────────────────────────────────────────
export function TimerBar() {
  const [serverOffset, setServerOffset] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [tz] = useState(tzAbbr)

  const activeProductionId = useProductionStore((s) => s.activeProductionId)
  const updateAirTime = useProductionsStore((s) => s.updateAirTime)
  const programStartMs = useProgramStartMs()

  // Popover
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [inputHHMM, setInputHHMM]     = useState('')
  const popoverRef  = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLInputElement>(null)

  // Server time sync (once on mount)
  useEffect(() => { void fetchServerOffset().then(setServerOffset) }, [])

  // Tick every second
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node))
        setPopoverOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpen])

  // Focus input when popover opens
  useEffect(() => {
    if (popoverOpen) setTimeout(() => inputRef.current?.focus(), 0)
  }, [popoverOpen])

  const serverNow = now + serverOffset

  // ── Wall clock ───────────────────────────────────────────────────────────
  const wallTime = new Date(serverNow).toLocaleTimeString('en-GB', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  // ── Program clock ────────────────────────────────────────────────────────
  const mode = getProgramMode(programStartMs, serverNow)

  let programDisplay = '--:--:--'
  let programLabel   = 'PROGRAM'
  let programColor   = 'text-zinc-400'

  if (programStartMs !== null) {
    const diffMs = programStartMs - serverNow

    if (mode === 'scheduled') {
      programDisplay = new Date(programStartMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
      programLabel   = 'SCHED'
      programColor   = 'text-zinc-500'
    } else if (mode === 'countdown') {
      programDisplay = '-' + formatHMS(Math.ceil(diffMs / 1000))
      programLabel   = 'COUNTDOWN'
      programColor   = 'text-yellow-400'
    } else if (mode === 'onair') {
      programDisplay = formatHMS(Math.floor(-diffMs / 1000))
      programLabel   = 'ON AIR'
      programColor   = 'text-red-400'
    } else {
      // expired
      programDisplay = '--:--:--'
      programLabel   = 'PROGRAM'
      programColor   = 'text-zinc-600'
    }
  }

  // ── Popover helpers ──────────────────────────────────────────────────────
  const openPopover = useCallback(() => {
    if (programStartMs !== null) {
      const d = new Date(programStartMs)
      setInputHHMM(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
    } else {
      setInputHHMM('')
    }
    setPopoverOpen(true)
  }, [programStartMs])

  const commitStartTime = useCallback(() => {
    if (!activeProductionId) { setPopoverOpen(false); return }
    const match = /^(\d{1,2}):(\d{2})$/.exec(inputHHMM.trim())
    if (!match) { setPopoverOpen(false); return }
    const hh = parseInt(match[1]!, 10)
    const mm = parseInt(match[2]!, 10)
    if (hh > 23 || mm > 59) { setPopoverOpen(false); return }
    const t = new Date(serverNow)
    t.setHours(hh, mm, 0, 0)
    if (serverNow - t.getTime() > PROGRAM_WINDOW_MS) t.setDate(t.getDate() + 1)
    void updateAirTime(activeProductionId, t.toISOString())
    setPopoverOpen(false)
  }, [inputHHMM, serverNow, activeProductionId, updateAirTime])

  const clearStartTime = useCallback(() => {
    if (activeProductionId) void updateAirTime(activeProductionId, null)
    setPopoverOpen(false)
  }, [activeProductionId, updateAirTime])

  return (
    <div className="flex items-center gap-0 text-[10px] font-mono border border-zinc-800 bg-zinc-950">

      {/* Real-time clock */}
      <div className="px-3 py-1.5 border-r border-zinc-800 text-zinc-400" title="Local time (server-synced)">
        <span className="block text-[8px] uppercase tracking-widest text-zinc-600 mb-0.5">{tz}</span>
        <span>{wallTime}</span>
      </div>

      {/* Program clock — click to set start time */}
      <div className="relative" ref={popoverRef}>
        <button
          onClick={openPopover}
          title={activeProductionId ? 'Set program start time' : 'No active production'}
          disabled={!activeProductionId}
          className={[
            'btn-hardware flex flex-col px-3 py-1.5 border-r border-zinc-800 text-left transition-colors',
            activeProductionId ? 'cursor-pointer' : 'cursor-default opacity-50',
            popoverOpen ? 'bg-zinc-900' : activeProductionId ? 'hover:bg-zinc-900/50' : '',
          ].join(' ')}
        >
          <span className="block text-[8px] uppercase tracking-widest text-zinc-600 mb-0.5">{programLabel}</span>
          <span className={`tabular-nums ${programColor}`}>{programDisplay}</span>
        </button>

        {popoverOpen && (
          <div className="absolute top-full right-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 shadow-xl p-3 flex flex-col gap-2" style={{ minWidth: 180 }}>
            <span className="text-[9px] uppercase tracking-widest text-zinc-500">Program start time ({tz})</span>
            <input
              ref={inputRef}
              type="text"
              placeholder="HH:MM"
              value={inputHHMM}
              maxLength={5}
              onChange={(e) => setInputHHMM(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitStartTime()
                if (e.key === 'Escape') setPopoverOpen(false)
              }}
              className="bg-zinc-800 border border-zinc-600 px-2 py-1 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-orange-500 w-full"
            />
            <div className="flex gap-1">
              <button
                onClick={commitStartTime}
                className="btn-hardware flex-1 px-2 py-1 text-[9px] uppercase tracking-widest bg-orange-500 text-black border-0 hover:bg-orange-400 cursor-pointer transition-colors"
              >
                Set
              </button>
              {programStartMs !== null && (
                <button
                  onClick={clearStartTime}
                  className="btn-hardware px-2 py-1 text-[9px] uppercase tracking-widest text-zinc-400 bg-zinc-800 border border-zinc-600 hover:text-white cursor-pointer transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
