import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * "Open draft" was wired to focusReply, which *creates* a reply draft rather
 * than opening one. Clicking it added a blank "Manual draft" on top of the
 * generated draft it was meant to reveal, and left two drafts on the thread.
 *
 * The types cannot catch this — focusReply and the correct handler are both
 * `() => void` — so it is pinned here against the source.
 */
describe('Ask panel: Open draft', () => {
  // Comments are stripped so the assertion is about the wiring, not about
  // prose that happens to name the wrong handler while explaining it.
  const source = readFileSync(
    new URL('./ThreadReader.tsx', import.meta.url),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  const openDraftHandler = (): string => {
    const marker = 'Open draft'
    const at = source.indexOf(marker)
    expect(at, 'the Open draft control has gone missing').toBeGreaterThan(-1)
    // The handler sits above the label inside the same JSX element.
    return source.slice(Math.max(0, at - 900), at)
  }

  it('opens the draft that already exists rather than creating one', () => {
    // Since replies moved into the docked compose window, "opening" the
    // generated draft means seeding that window with it.
    expect(openDraftHandler()).toContain('openDraftInComposeWindow')
  })

  it('never calls focusReply, which would create a second blank draft', () => {
    expect(openDraftHandler()).not.toContain('focusReply')
  })
})
