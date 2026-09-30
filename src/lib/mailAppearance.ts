import { createGlobalStyle } from 'styled-components'

/**
 * Mail's two backgrounds, in light mode:
 * - Glass is the shared White look (solid, softly tinted surfaces), which reads
 *   better for mail than frosted panels over a wallpaper.
 * - White is plain neutral greys, clearly different from Glass.
 *
 * The shared frame writes the saved choice to `data-platform-appearance`. Here
 * the choice is kept in `data-mail-appearance`, and in light mode the document
 * is always rendered as White, so Glass gets every shared White style exactly;
 * the neutral greys below apply only when White itself was chosen. Dark mode is
 * left as the frame sets it.
 */
export function installMailAppearance(root: HTMLElement = document.documentElement): () => void {
  let chosen: string | null = root.getAttribute('data-platform-appearance')
  let ownWrites = 0

  const render = () => {
    if (chosen) root.setAttribute('data-mail-appearance', chosen)
    else root.removeAttribute('data-mail-appearance')
    const dark = root.getAttribute('data-platform-theme') === 'dark'
    const want = chosen && !dark ? 'white' : chosen
    if (root.getAttribute('data-platform-appearance') === want) return
    ownWrites += 1
    if (want) root.setAttribute('data-platform-appearance', want)
    else root.removeAttribute('data-platform-appearance')
  }

  const observer = new MutationObserver(records => {
    let changed = false
    for (const record of records) {
      if (record.attributeName === 'data-platform-theme') changed = true
      if (record.attributeName !== 'data-platform-appearance') continue
      if (ownWrites > 0) {
        ownWrites -= 1
        continue
      }
      chosen = root.getAttribute('data-platform-appearance')
      changed = true
    }
    if (changed) render()
  })
  observer.observe(root, { attributes: true, attributeFilter: ['data-platform-appearance', 'data-platform-theme'] })
  render()
  return () => observer.disconnect()
}

/** White chosen, light mode: neutral greys over the shared White, sidebar included. */
export const MailWhiteNeutral = createGlobalStyle`
  html:root[data-mail-appearance='white']:not([data-platform-theme='dark']) {
    --platform-colors-bg: #f2f2f2 !important;
    --platform-colors-app-viewport: #f2f2f2 !important;
    --platform-colors-surface: #f7f7f7 !important;
    --platform-colors-elevated: #ffffff !important;
    --platform-colors-surface-hover: #ececec !important;
    --platform-colors-surface-active: #e4e4e4 !important;
    --platform-colors-chrome-titlebar: #f6f6f6 !important;
    --platform-colors-border: #dcdcdc !important;
    --platform-colors-border-soft: #e6e6e6 !important;
    --platform-colors-border-strong: #bdbdbd !important;
    --platform-colors-divider: #e3e3e3 !important;
    --pure-chrome-sidebar: #f7f7f7 !important;
    --pure-chrome-well: #ececec !important;
    --pure-chrome-hover: #ebebeb !important;
    --pure-chrome-selection: #e3e3e3 !important;
    --pure-chrome-line: #dcdcdc !important;
    --pure-chrome-fence: #e6e6e6 !important;
    --glass-panel: #f7f7f7 !important;
    --glass-well: #ececec !important;
    --glass-edge: #dcdcdc !important;
    --glass-line: #e0e0e0 !important;
  }
  html:root[data-mail-appearance='white']:not([data-platform-theme='dark']) body {
    background: #f2f2f2 !important;
  }
  html:root[data-mail-appearance='white']:not([data-platform-theme='dark']) [data-chrome='sidebar'] {
    --pure-chrome-line: #dcdcdc;
    --pure-chrome-fence: #e6e6e6;
    --pure-chrome-muted: #6b6b6b;
    --pure-chrome-hover: #ebebeb;
    --pure-chrome-selection: #e3e3e3;
  }
  html:root[data-mail-appearance='white']:not([data-platform-theme='dark']) [data-chrome='sidebar'] :is([aria-current]:not([aria-current='false']), [aria-selected='true'], [data-active]) {
    box-shadow: inset 0 0 0 1px #d6d6d6;
  }
`
