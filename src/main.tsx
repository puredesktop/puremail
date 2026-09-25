import { createRoot } from 'react-dom/client'
import { bridge } from '@purescience/platform-ui/bridge/client'
import { App } from './App'

bridge.deferViewportReady()

createRoot(document.getElementById('root')!).render(<App />)
