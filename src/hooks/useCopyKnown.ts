import { useEffect, useState } from 'react'
import { bridge, PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/client'
import { copyIsKnown, findOutIfHeld } from '../lib/heldCopy'

/** False until this copy knows whether it is held in a page. Nothing that runs on its own starts before that. */
export function useCopyKnown(ready: boolean): boolean {
  const [known, setKnown] = useState(copyIsKnown)
  useEffect(() => {
    if (!ready || known) return
    let live = true
    void findOutIfHeld(() => bridge.call(PLATFORM_BRIDGE_METHODS.WORKSPACE_ADJACENT_APP)).then(() => { if (live) setKnown(true) })
    return () => { live = false }
  }, [ready, known])
  return known
}
