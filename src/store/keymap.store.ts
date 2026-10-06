import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { DEFAULT_KEYMAP, loadKeymap, saveKeymap, type Keymap } from '@/lib/keymap'

/**
 * Active controller keymap (studio#173).
 *
 * Initialised from `localStorage` (falling back to the default seeded from the
 * old hardcoded shortcuts) so both the full controller and the popped-out panes
 * read one shared binding set. Every mutation is persisted. There is no UI to
 * edit the map yet — that arrives with the settings surface in studio#174, which
 * will drive `setKeymap` / `resetToDefault`.
 */
interface KeymapState {
  keymap: Keymap
  setKeymap: (keymap: Keymap) => void
  resetToDefault: () => void
}

export const useKeymapStore = create<KeymapState>()(
  devtools(
    (set) => ({
      keymap: loadKeymap(),
      setKeymap: (keymap) => {
        saveKeymap(keymap)
        set({ keymap })
      },
      resetToDefault: () => {
        const next: Keymap = { ...DEFAULT_KEYMAP }
        saveKeymap(next)
        set({ keymap: next })
      },
    }),
    { name: 'keymap' },
  ),
)
