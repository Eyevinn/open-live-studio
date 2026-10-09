/**
 * Compare two `mixerInput` names (`video_in_N`) numerically by pad number, the
 * order the multiviewer and mixer pads use. A plain text compare puts
 * `video_in_10`/`video_in_15` before `video_in_2` (open-live-studio#189).
 * Names without a numeric `video_in_N` suffix sort after numbered ones and
 * fall back to `localeCompare` so the order stays deterministic.
 */
export function compareMixerInput(a: string, b: string): number {
  const na = padNumber(a)
  const nb = padNumber(b)
  if (na !== null && nb !== null) return na - nb || a.localeCompare(b)
  if (na !== null) return -1
  if (nb !== null) return 1
  return a.localeCompare(b)
}

function padNumber(mixerInput: string): number | null {
  const m = /video_in_(\d+)$/.exec(mixerInput ?? '')
  return m?.[1] !== undefined ? parseInt(m[1], 10) : null
}
