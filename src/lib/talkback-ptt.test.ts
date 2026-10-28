import { describe, expect, it } from 'vitest'
import { INITIAL_TALK_STATE, isTalking, talkReducer, type TalkAction, type TalkState } from './talkback-ptt'

const run = (...actions: TalkAction[]): TalkState => actions.reduce(talkReducer, INITIAL_TALK_STATE)

describe('talkback PTT state machine (studio#237, OQ1)', () => {
  it('press enables, release disables', () => {
    const held = run({ type: 'press', guestId: 'a' })
    expect(isTalking(held, 'a')).toBe(true)
    expect(isTalking(talkReducer(held, { type: 'release', guestId: 'a' }), 'a')).toBe(false)
  })

  it('a window blur / visibility-hidden / pointercancel (cancel-hold) releases a held press', () => {
    const s = run({ type: 'press', guestId: 'a' }, { type: 'cancel-hold' })
    expect(isTalking(s, 'a')).toBe(false)
  })

  it('releasing a different guest does not end the held press', () => {
    const s = run({ type: 'press', guestId: 'a' }, { type: 'release', guestId: 'b' })
    expect(isTalking(s, 'a')).toBe(true)
  })

  it('latch keeps talk on after release and after cancel-hold', () => {
    const s = run(
      { type: 'toggle-latch', guestId: 'a' },
      { type: 'press', guestId: 'a' },
      { type: 'release', guestId: 'a' },
      { type: 'cancel-hold' },
    )
    expect(isTalking(s, 'a')).toBe(true)
    expect(isTalking(talkReducer(s, { type: 'toggle-latch', guestId: 'a' }), 'a')).toBe(false)
  })

  it('latching guest B releases guest A — only one latch at a time', () => {
    const s = run({ type: 'toggle-latch', guestId: 'a' }, { type: 'toggle-latch', guestId: 'b' })
    expect(isTalking(s, 'a')).toBe(false)
    expect(isTalking(s, 'b')).toBe(true)
    expect(s.latched).toBe('b')
  })

  it('remove drops hold and latch for that guest only', () => {
    const s = run({ type: 'toggle-latch', guestId: 'a' }, { type: 'press', guestId: 'b' }, { type: 'remove', guestId: 'a' })
    expect(s).toEqual({ held: 'b', latched: null })
  })

  it('returns the same state for no-op actions', () => {
    const s = run({ type: 'press', guestId: 'a' })
    expect(talkReducer(s, { type: 'press', guestId: 'a' })).toBe(s)
    expect(talkReducer(INITIAL_TALK_STATE, { type: 'cancel-hold' })).toBe(INITIAL_TALK_STATE)
  })
})
