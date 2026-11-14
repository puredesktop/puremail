import './heldInRoom'
import { createRoot } from 'react-dom/client'
import { bridge } from '@purescience/platform-ui/bridge/client'
import { App } from './App'
import { installMailAppearance } from './lib/mailAppearance'
import { MailStyles } from './ui/styles'
import { guardDevelopmentTiming } from './lib/developmentTiming'

if (import.meta.env.DEV) {
  const restore = guardDevelopmentTiming(performance)
  import.meta.hot?.dispose(restore)
}

bridge.deferViewportReady()

installMailAppearance()

createRoot(document.getElementById('root')!).render(
  <>
    <MailStyles />
    <App />
  </>,
)
