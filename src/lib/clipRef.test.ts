import { describe, expect, it } from 'vitest'
import { emptyClipRef, parseClipRef, serializeClipRef, type ClipRefState } from './clipRef'

describe('clipRef round trip (studio#217)', () => {
  it('keeps connectionId through parse and serialize', () => {
    const stored = JSON.stringify({ type: 's3', bucket: 'my-clips', key: 'a/b.mp4', connectionId: 'stconn-123' })
    const parsed = parseClipRef(stored)
    expect(parsed).toEqual({ type: 's3', url: '', bucket: 'my-clips', key: 'a/b.mp4', connectionId: 'stconn-123' })
    expect(serializeClipRef(parsed)).toBe(stored)
  })

  it('round-trips an s3 reference without connectionId byte-for-byte', () => {
    const stored = JSON.stringify({ type: 's3', bucket: 'my-clips', key: 'a/b.mp4' })
    const parsed = parseClipRef(stored)
    expect(parsed.connectionId).toBe('')
    expect(serializeClipRef(parsed)).toBe(stored)
  })

  it('serializes the default picker choice with no connectionId', () => {
    const ref: ClipRefState = { ...emptyClipRef, type: 's3', bucket: 'b-1', key: 'k' }
    expect(JSON.parse(serializeClipRef(ref))).toEqual({ type: 's3', bucket: 'b-1', key: 'k' })
    expect(JSON.parse(serializeClipRef({ ...ref, connectionId: 'default' }))).toEqual({ type: 's3', bucket: 'b-1', key: 'k' })
  })

  it('treats an explicit "default" connectionId as the default', () => {
    const parsed = parseClipRef(JSON.stringify({ type: 's3', bucket: 'b-1', key: 'k', connectionId: 'default' }))
    expect(parsed.connectionId).toBe('')
  })

  it('never writes connectionId on a url reference', () => {
    const ref: ClipRefState = { ...emptyClipRef, type: 'url', url: ' https://x.test/c.mp4 ', connectionId: 'stconn-1' }
    expect(JSON.parse(serializeClipRef(ref))).toEqual({ type: 'url', url: 'https://x.test/c.mp4' })
    expect(parseClipRef(serializeClipRef(ref)).connectionId).toBe('')
  })

  it('falls back to an empty url reference on unparseable input', () => {
    expect(parseClipRef('not json')).toEqual(emptyClipRef)
    expect(parseClipRef('null')).toEqual(emptyClipRef)
  })
})
