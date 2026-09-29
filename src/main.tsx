import { createRoot } from 'react-dom/client'
import { bridge } from '@purescience/platform-ui/bridge/client'
import { App } from './App'
import { guardDevelopmentTiming } from './lib/developmentTiming'

if (import.meta.env.DEV) {
  const restore = guardDevelopmentTiming(performance)
  import.meta.hot?.dispose(restore)
}

bridge.deferViewportReady()

createRoot(document.getElementById('root')!).render(<App />)
