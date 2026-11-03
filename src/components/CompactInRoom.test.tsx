// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { ServerStyleSheet } from 'styled-components'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppFrame } from '@purescience/platform-bridge/components/AppFrame'
import { useCompactInRoom } from '../hooks/useCompactInRoom'
import { DRAFT_LINK_PREFIX } from '../lib/executiveShare'
import { demoMailStore } from '../test/mailFixtures'
import { CompactInRoomStyle } from './CompactInRoom'
import { MAIL_LAYOUT_STORAGE_KEY } from './mailShellLayout'
import { ReaderStateLine } from './mailShellStyles'
import { PureMailShell } from './PureMailShell'

vi.mock('../hooks/useCompactInRoom', async importActual => ({
  ...(await importActual<typeof import('../hooks/useCompactInRoom')>()),
  useCompactInRoom: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
const q = (selector: string) => document.querySelector<HTMLElement>(selector)
const qq = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))
const inboxRows = () => qq('[aria-label="Inbox"] [data-agent-ref]')
const heading = () => q('[aria-label="Inbox"] h2')?.textContent

/**
 * styled-components injects nothing under vitest (its server build), so the
 * real sheet is compiled here and its hide rules are matched against the DOM.
 * This proves which elements the rules reach, not how the result looks.
 */
function compactHideSelectors(): string[] {
  const sheet = new ServerStyleSheet()
  renderToString(sheet.collectStyles(<CompactInRoomStyle />))
  const css = sheet.getStyleTags().replace(/<[^>]+>/g, '').replace(/\/\*.*?\*\//g, '')
  sheet.seal()
  return Array.from(css.matchAll(/([^{}]+)\{[^{}]*display:\s*none\s*!important[^{}]*\}/g))
    .flatMap(match => match[1].split(/,(?![^(]*\))/))
    .map(selector => selector.trim())
}
const hideSelectors = compactHideSelectors()

const hidden = (element: Element | null): boolean => {
  expect(element, 'still mounted').toBeTruthy()
  for (let at: Element | null = element; at; at = at.parentElement) {
    if (hideSelectors.some(selector => at!.matches(selector))) return true
  }
  return false
}

let root: Root | null = null

function renderShell(compact: boolean, openedFile: { path: string } | null = null): void {
  vi.mocked(useCompactInRoom).mockReturnValue(compact)
  root!.render(
    <AppFrame>
      <PureMailShell
        initialProvider="demo"
        mailProvider={undefined as never}
        initialStore={store}
        initialNotice={null as never}
        openedFile={openedFile}
      />
    </AppFrame>,
  )
}

let store = demoMailStore()

async function mountShell(compact: boolean, openedFile: { path: string } | null = null): Promise<void> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => renderShell(compact, openedFile))
  await settle()
}

async function setCompact(compact: boolean): Promise<void> {
  await act(async () => renderShell(compact))
  await settle()
}

async function click(element: Element | null | undefined): Promise<void> {
  expect(element, 'something to click').toBeTruthy()
  await act(async () => (element as HTMLElement).click())
  await settle()
}

/** The full app was last left on Sent. */
function savedView(query = 'in:sent'): string {
  const saved = JSON.stringify({ query, reading: false, density: 'compact', taskMode: 'mine', taskDrawerOpen: {} })
  window.localStorage.setItem(MAIL_LAYOUT_STORAGE_KEY, saved)
  return saved
}

describe('PureMail beside the Executive app', () => {
  beforeEach(() => {
    window.localStorage.clear()
    store = demoMailStore()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-20T16:12:00.000Z') })
  })
  afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('compiles the hide rules', () => {
    expect(hideSelectors.length).toBeGreaterThan(20)
    for (const selector of hideSelectors) {
      expect(selector).toContain('[data-compact-in-room]')
      expect(selector).not.toMatch(/undefined|object Object/)
    }
  })

  it('adds nothing to the page when off', async () => {
    await mountShell(false)
    expect(q('[data-compact-in-room]')).toBeNull()
    expect(q('[data-compact-keep]')).toBeNull()
    expect(q('[aria-label="Inbox"]')).toBeNull()
    expect(hidden(q('nav[aria-label="Mailboxes and views"]'))).toBe(false)
    expect(hidden(q('[aria-label="Thread filters"]'))).toBe(false)
    expect(hidden(q('[aria-label^="Open conversation:"]'))).toBe(false)
  })

  it('opens on the Inbox, whatever the full app last showed, and leaves that saved', async () => {
    const saved = savedView()
    await mountShell(true)
    const unread = new Set(store.messages.filter(message => !message.read).map(message => message.threadId))
    const inbox = store.threads.filter(thread => thread.mailboxId === store.mailboxes.find(box => box.role === 'inbox')?.id)
    const expectedUnread = inbox.filter(thread => unread.has(thread.id)).length
    expect(expectedUnread).toBeGreaterThan(0)
    expect(heading()).toBe(`Inbox · ${expectedUnread} unread`)
    expect(inboxRows().length).toBeGreaterThan(1)
    expect(window.localStorage.getItem(MAIL_LAYOUT_STORAGE_KEY)).toBe(saved)
  })

  it('shows sender, subject, preview and when on each row, newest first', async () => {
    await mountShell(true)
    const newest = [...store.threads]
      .filter(thread => thread.mailboxId === store.mailboxes.find(box => box.role === 'inbox')?.id)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))[0]
    const parts = Array.from(inboxRows()[0].children).map(part => part.textContent ?? '')
    expect(parts).toHaveLength(4)
    const [sender, when, subject, preview] = parts
    expect(sender).toBeTruthy()
    expect(when).toBeTruthy()
    expect(subject).toBe(newest.subject)
    expect(preview).toBe(newest.summary)
  })

  it('hides the full app around the list but keeps it mounted', async () => {
    await mountShell(true)
    expect(hidden(q('nav[aria-label="Mailboxes and views"]'))).toBe(true)
    expect(hidden(q('[aria-label="Thread filters"]'))).toBe(true)
    expect(hidden(q('[aria-label="Tasks"]'))).toBe(true)
    expect(hidden(q('[aria-label="Thread list"]'))).toBe(true)
    expect(hidden(q('[data-mail-scroll]'))).toBe(true)
    expect(hidden(q('[aria-label="Inbox"]'))).toBe(false)
  })

  it('fills the box with an opened thread, with Back and Reply, and Back returns to the Inbox', async () => {
    const saved = savedView()
    await mountShell(true)
    const before = heading()
    await click(inboxRows()[0])
    expect(q('[aria-label="Inbox"]')).toBeNull()
    expect(hidden(q('[aria-label="Back to the thread list (Esc)"]'))).toBe(false)
    const reply = qq('[aria-label="Mail actions"] button')
      .find(button => /^(reply|.*draft)/i.test(button.textContent ?? ''))
    expect(hidden(reply ?? null)).toBe(false)
    expect(hidden(q('[aria-label="Move to Trash"]'))).toBe(true)
    expect(hidden(q('[aria-label="More thread actions"]'))).toBe(true)
    expect(hidden(q('[aria-label="Older thread (j)"]'))).toBe(true)
    expect(hidden(q('[id^="puremail-message-"]'))).toBe(false)
    const triage = q('[aria-label="Triage verdict"]')
    expect(hidden(triage)).toBe(true)
    expect(hidden(triage!.closest(String(ReaderStateLine)))).toBe(false)
    expect(window.localStorage.getItem(MAIL_LAYOUT_STORAGE_KEY)).toBe(saved)
    await click(q('[aria-label="Back to the thread list (Esc)"]'))
    expect(heading()?.startsWith('Inbox')).toBe(true)
    expect(before?.startsWith('Inbox')).toBe(true)
  })

  it('leaves To, Subject, the body, Send and Close in New message', async () => {
    await mountShell(true)
    await click(qq('[aria-label="Inbox"] button').find(button => button.textContent === 'New message'))
    const dock = q('[data-puremail-compose-dock]')!
    const within = (selector: string) => dock.querySelector(selector)
    expect(hidden(dock)).toBe(false)
    expect(hidden(within('[data-release="send"]'))).toBe(false)
    expect(hidden(within('[aria-label="Close"]'))).toBe(false)
    expect(within('[aria-label="To recipients"]')).toBeTruthy()
    expect(hidden(within('[aria-label="Minimize"]'))).toBe(true)
    expect(hidden(within('[aria-label="Open full screen"]'))).toBe(true)
    expect(hidden(within('[aria-label="Text formatting"]'))).toBe(true)
    expect(hidden(within('[aria-label="Attach files"]'))).toBe(true)
    expect(hidden(within('[aria-label="Send later"]'))).toBe(true)
    expect(hidden(within('[aria-label="Discard draft"]'))).toBe(true)
  })

  it('opens a draft from the room as its composer', async () => {
    const draft = store.drafts.find(item => !item.sentAt)
    expect(draft).toBeTruthy()
    await mountShell(true, { path: `${DRAFT_LINK_PREFIX}${draft!.id}` })
    expect(hidden(q('[data-puremail-compose-dock]'))).toBe(false)
    expect(q('[data-puremail-compose-dock] [data-release="send"]')).toBeTruthy()
    expect(q('[data-puremail-compose-dock] [aria-label="To recipients"]')).toBeTruthy()
  })

  it('finds the full app as it was on growing, and again after coming back', async () => {
    savedView()
    await mountShell(false)
    const saved = window.localStorage.getItem(MAIL_LAYOUT_STORAGE_KEY)
    const toolbarSays = () => q('[aria-label="Thread list"]')?.textContent ?? ''
    expect(toolbarSays()).toContain('Sent')
    await setCompact(true)
    expect(heading()?.startsWith('Inbox')).toBe(true)
    await click(inboxRows()[0])
    expect(window.localStorage.getItem(MAIL_LAYOUT_STORAGE_KEY)).toBe(saved)
    await setCompact(false)
    expect(q('[data-compact-in-room]')).toBeNull()
    expect(toolbarSays()).toContain('Sent')
    expect(q('[aria-label="Mail actions"]')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(MAIL_LAYOUT_STORAGE_KEY)!).query).toBe('in:sent')
    await setCompact(true)
    expect(q('[aria-label="Mail actions"]')).toBeTruthy()
  })

  it('keeps the full app\'s open thread and ticked rows across the box', async () => {
    await mountShell(false)
    await click(q('[aria-label^="Select conversation:"]'))
    const ticked = () => qq('[aria-label^="Select conversation:"][aria-checked="true"]').length
    expect(ticked()).toBe(1)
    await setCompact(true)
    await click(inboxRows()[1])
    await setCompact(false)
    expect(ticked()).toBe(1)
  })
})
