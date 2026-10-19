// ─── Clip source reference (studio#148, backing open-live clip-reference.ts) ──
// A `clip` source has no SRT/EFP/HTML address; instead the operator picks a
// reference the backend can resolve, serialized as JSON into the same
// `SourceDoc.address` field. Mirrors the `open-live` `ClipReference` union
// (issue open-live#275, epic #206): `url` and `s3` are implemented and
// validated; `tams` returns 501 in v1, so it is intentionally not offered here.
export type ClipRefType = 'url' | 's3'

export const CLIP_REF_LABELS: Record<ClipRefType, string> = {
  url: 'URL',
  s3: 'S3',
}

// Bucket names follow the DNS-compatible S3/MinIO rule set the backend enforces
// (3–63 chars, lowercase alnum plus dots/hyphens, alphanumeric at both ends).
const S3_BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

export interface ClipRefState {
  type: ClipRefType
  url: string
  bucket: string
  key: string
  /**
   * Storage connection of an `s3` reference (open-live #520). Empty means the
   * instance default and is omitted from the serialized reference.
   */
  connectionId: string
}

export const emptyClipRef: ClipRefState = { type: 'url', url: '', bucket: '', key: '', connectionId: '' }

/**
 * Validates a clip reference against the same rules the backend applies, so the
 * operator gets inline feedback before the create/update round-trips. Returns an
 * error string, or null when valid.
 */
export function validateClipRef(ref: ClipRefState): string | null {
  if (ref.type === 'url') {
    if (!ref.url.trim()) return 'Clip URL is required'
    try {
      const u = new URL(ref.url.trim())
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error()
    } catch {
      return 'Must be a valid http:// or https:// URL'
    }
    return null
  }
  if (!ref.bucket.trim()) return 'Bucket is required'
  if (!S3_BUCKET_RE.test(ref.bucket.trim()) || /^\d{1,3}(\.\d{1,3}){3}$/.test(ref.bucket.trim())) {
    return 'Invalid bucket — 3–63 lowercase chars (a–z, 0–9, dot, hyphen), alphanumeric at both ends'
  }
  if (!ref.key.trim()) return 'Object key is required'
  if (ref.key.startsWith('/')) return 'Object key must not start with "/"'
  return null
}

/**
 * Serializes a validated clip reference to the JSON string stored in `address`.
 * `connectionId` is written only for a non-default s3 connection, so a reference
 * on the default is byte-identical to the pre-#217 format.
 */
export function serializeClipRef(ref: ClipRefState): string {
  if (ref.type === 'url') return JSON.stringify({ type: 'url', url: ref.url.trim() })
  const connectionId = ref.connectionId.trim()
  return JSON.stringify({
    type: 's3',
    bucket: ref.bucket.trim(),
    key: ref.key.trim(),
    ...(connectionId && connectionId !== 'default' ? { connectionId } : {}),
  })
}

/** Best-effort parse of a stored clip-reference JSON string back into form state. */
export function parseClipRef(stored: string): ClipRefState {
  try {
    const parsed = JSON.parse(stored) as Partial<ClipRefState> | null
    if (parsed?.type === 's3') {
      return {
        type: 's3',
        url: '',
        bucket: parsed.bucket ?? '',
        key: parsed.key ?? '',
        // An explicit "default" is the same as absent; the picker models it as ''.
        connectionId:
          typeof parsed.connectionId === 'string' && parsed.connectionId !== 'default' ? parsed.connectionId : '',
      }
    }
    if (parsed?.type === 'url') {
      return { type: 'url', url: parsed.url ?? '', bucket: '', key: '', connectionId: '' }
    }
  } catch {
    // Unparseable / legacy address: fall through to an empty URL reference.
  }
  return { ...emptyClipRef }
}
