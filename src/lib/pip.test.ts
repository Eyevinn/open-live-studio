import { describe, it, expect } from 'vitest'
import { zonesCoverFrame, pipShowsBlackBehind } from './pip'
import type { PipZone } from '@/store/production.store'

const zone = (rect: PipZone['rect'], sources: number[] = [0]): PipZone => ({
  rect,
  capacity: null,
  sources,
})

describe('zonesCoverFrame', () => {
  it('is false for no zones', () => {
    expect(zonesCoverFrame([])).toBe(false)
  })

  it('is true for a single full-frame zone', () => {
    expect(zonesCoverFrame([zone({ x: 0, y: 0, w: 1, h: 1 })])).toBe(true)
  })

  it('treats a null (AUTO) rect as full-frame coverage', () => {
    expect(zonesCoverFrame([zone(null)])).toBe(true)
  })

  it('is false for a single partial zone', () => {
    expect(zonesCoverFrame([zone({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })])).toBe(false)
  })

  it('is true when two zones tile the whole frame', () => {
    expect(
      zonesCoverFrame([
        zone({ x: 0, y: 0, w: 0.5, h: 1 }),
        zone({ x: 0.5, y: 0, w: 0.5, h: 1 }),
      ]),
    ).toBe(true)
  })

  it('is false when tiling zones leave a gap', () => {
    expect(
      zonesCoverFrame([
        zone({ x: 0, y: 0, w: 0.5, h: 1 }),
        zone({ x: 0.5, y: 0, w: 0.4, h: 1 }),
      ]),
    ).toBe(false)
  })

  it('ignores zones with no sources', () => {
    expect(zonesCoverFrame([zone({ x: 0, y: 0, w: 1, h: 1 }, [])])).toBe(false)
  })
})

describe('pipShowsBlackBehind', () => {
  it('flags a no-background PiP whose zones do not cover the frame', () => {
    expect(pipShowsBlackBehind({ bg: null, zones: [zone({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })] })).toBe(true)
  })

  it('does not flag a no-background PiP whose zones cover the frame', () => {
    expect(pipShowsBlackBehind({ bg: null, zones: [zone({ x: 0, y: 0, w: 1, h: 1 })] })).toBe(false)
  })

  it('does not flag a PiP that has a background', () => {
    expect(pipShowsBlackBehind({ bg: 0, zones: [zone({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })] })).toBe(false)
  })

  it('flags a no-background PiP with no zones at all', () => {
    expect(pipShowsBlackBehind({ bg: null, zones: [] })).toBe(true)
  })
})
