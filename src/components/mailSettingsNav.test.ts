import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SETTINGS_SECTIONS } from './MailSettings'

/**
 * The settings nav used to list a section whose card had been deleted (the
 * click scrolled nowhere) while four rendered cards had no nav entry at all.
 * Both directions are a silent UI failure, so pin them.
 */
describe('settings nav', () => {
  const source = readFileSync(
    new URL('./MailSettings.tsx', import.meta.url),
    'utf8',
  )
  const renderedIds = [
    ...source.matchAll(/<SettingsCard\s+id="([^"]+)"/g),
  ].map(match => match[1])

  it('renders a card for every nav entry', () => {
    for (const [label, id] of SETTINGS_SECTIONS) {
      expect(renderedIds, `nav entry "${label}" has no card`).toContain(id)
    }
  })

  it('has a nav entry for every rendered card', () => {
    const navIds = SETTINGS_SECTIONS.map(([, id]) => id)
    for (const id of renderedIds) {
      expect(navIds, `card "${id}" is unreachable from the nav`).toContain(id)
    }
  })
})
