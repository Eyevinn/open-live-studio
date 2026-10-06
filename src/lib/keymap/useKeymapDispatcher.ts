/**
 * React binding for the controller keyboard dispatcher (studio#173).
 *
 * Attaches a single `keydown` listener on `window` that routes every event
 * through {@link dispatchKeyboardEvent}. The keymap and handler set are read
 * from a ref so changing them (new bindings, new closures each render) never
 * re-subscribes the listener; only toggling `enabled` does.
 */

import { useEffect, useRef } from 'react'
import { dispatchKeyboardEvent } from './dispatcher'
import type { Keymap } from './keymap'
import type { ActionHandlers } from './actions'

export interface UseKeymapDispatcherOptions {
  /** When false, no listener is attached (e.g. phone tier, or inactive pane). */
  enabled: boolean
  keymap: Keymap
  handlers: ActionHandlers
}

export function useKeymapDispatcher({ enabled, keymap, handlers }: UseKeymapDispatcherOptions): void {
  const latest = useRef({ keymap, handlers })
  latest.current = { keymap, handlers }

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      dispatchKeyboardEvent(event, latest.current.keymap, latest.current.handlers)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
