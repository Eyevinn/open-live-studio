import type { PipConfig, PipZone } from '@/store/production.store'

/**
 * Does the union of a PiP's zone rectangles cover the entire PGM frame?
 *
 * Strom's vision mixer draws each zone's sources inside that zone's rect and
 * leaves everywhere else transparent — so anywhere no zone covers falls through
 * to the PiP background (`bg`). A zone with `rect === null` is an AUTO
 * full-frame layout and therefore covers everything; empty zones (no sources)
 * draw nothing and are ignored.
 *
 * Coordinate-compression test: split the unit square at every zone edge and
 * check each resulting cell's centre lies inside at least one zone rect. O(n²)
 * cells for n zones, which is tiny for the handful of zones a PiP ever has.
 */
export function zonesCoverFrame(zones: PipZone[]): boolean {
  const rects = zones
    .filter((z) => z.sources.length > 0)
    .map((z) => z.rect ?? { x: 0, y: 0, w: 1, h: 1 })
    .map((r) => ({
      x0: Math.max(0, r.x),
      y0: Math.max(0, r.y),
      x1: Math.min(1, r.x + r.w),
      y1: Math.min(1, r.y + r.h),
    }))
    .filter((r) => r.x1 > r.x0 && r.y1 > r.y0)

  if (rects.length === 0) return false

  const xs = Array.from(new Set([0, 1, ...rects.flatMap((r) => [r.x0, r.x1])])).sort((a, b) => a - b)
  const ys = Array.from(new Set([0, 1, ...rects.flatMap((r) => [r.y0, r.y1])])).sort((a, b) => a - b)

  for (let i = 0; i < xs.length - 1; i++) {
    const cx = (xs[i]! + xs[i + 1]!) / 2
    for (let j = 0; j < ys.length - 1; j++) {
      const cy = (ys[j]! + ys[j + 1]!) / 2
      const covered = rects.some((r) => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1)
      if (!covered) return false
    }
  }
  return true
}

/**
 * True when a PiP has no background (`bg === null`) and its zones leave part of
 * the frame uncovered — i.e. taking it to programme would show black behind it.
 * A no-background PiP whose zones cover the whole frame is fine (black is never
 * visible), so it is deliberately not flagged.
 */
export function pipShowsBlackBehind(pip: Pick<PipConfig, 'bg' | 'zones'>): boolean {
  return pip.bg === null && !zonesCoverFrame(pip.zones)
}
