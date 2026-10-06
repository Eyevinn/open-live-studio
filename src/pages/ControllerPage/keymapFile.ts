/**
 * Browser file I/O for keymap import/export (studio#175).
 *
 * The keymap library (`@/lib/keymap`) stays pure and DOM-free: it only knows how
 * to serialise a {@link Keymap} to JSON and parse/validate JSON back into one.
 * This thin module is the browser glue — triggering a file download and reading
 * an uploaded file — so the DOM dependency lives next to the dialog that uses it
 * rather than polluting the shared lib.
 */

import { parseKeymap, serializeKeymap, type Keymap } from '@/lib/keymap'

const EXPORT_FILENAME = 'open-live-keymap.json'

/**
 * Trigger a browser download of `keymap` as a pretty-printed JSON file. Uses an
 * object URL and a transient anchor, revoking the URL afterwards so the blob is
 * not leaked.
 */
export function downloadKeymap(keymap: Keymap, filename: string = EXPORT_FILENAME): void {
  const json = serializeKeymap(keymap)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Read an uploaded file and parse it into a validated {@link Keymap}, or resolve
 * to `null` when the file cannot be read or its contents are not a valid keymap.
 * Validation (including dropping bindings to unknown action IDs) is delegated to
 * {@link parseKeymap}.
 */
export async function readKeymapFile(file: File): Promise<Keymap | null> {
  let text: string
  try {
    text = await file.text()
  } catch {
    return null
  }
  return parseKeymap(text)
}
