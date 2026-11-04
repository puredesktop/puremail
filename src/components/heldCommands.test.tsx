// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppFrame } from '@purescience/platform-bridge/components/AppFrame'
import { demoMailStore } from '../test/mailFixtures'
import { PureMailShell } from './PureMailShell'
import type { MailProvider, MailStore } from '../types'

// The page holding Mail sends its commands over the window; here the handler the shell gives is called straight.
const held = vi.hoisted(() => ({ handler: null as null | ((command: string, text: string) => Promise<{ ok: boolean; say?: string }> | { ok: boolean; say?: string }) }))
vi.mock('@purescience/platform-ui/bridge/react/heldCommand', () => ({
  useHeldCommand: (handler: typeof held.handler) => { held.handler = handler },
}))
vi.mock('../hooks/useCompactInRoom', async importActual => ({
  ...(await importActual<typeof import('../hooks/useCompactInRoom')>()),
  useCompactInRoom: () => compact.on,
}))
vi.mock('../hooks/useExecutiveMailShare', () => ({ useExecutiveMailShare: vi.fn(() => ({ afterSync: vi.fn(), teamReads: {} })) }))
// Anything that would put a draft on its way out is watched: a command must never reach it.
const sends = vi.hoisted(() => ({ sendDraft: vi.fn() }))
vi.mock('../lib/mailModel', async importActual => {
  const actual = await importActual<typeof import('../lib/mailModel')>()
  sends.sendDraft.mockImplementation(actual.sendDraft)
  return { ...actual, sendDraft: sends.sendDraft }
})
const compact = vi.hoisted(() => ({ on: true }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A provider that only records. It has no way to reach any server, so nothing here can really be sent. */
function recordingProvider() {
  const provider = {
    capabilities: { compose: true, drafts: true },
    fetchStore: vi.fn(),
    sync: vi.fn(async (store: MailStore) => store),
    send: vi.fn(async () => ({ id: 'recorded-send', threadId: 'thread', attachments: [] })),
    search: vi.fn(async () => []),
    labelThread: vi.fn(async () => undefined),
    archiveThread: vi.fn(async () => undefined),
    moveThread: vi.fn(async () => undefined),
    deleteThread: vi.fn(async () => undefined),
    markThreadRead: vi.fn(async () => undefined),
    createDraft: vi.fn(async () => 'provider-draft'),
    updateDraft: vi.fn(async () => undefined),
    deleteDraft: vi.fn(async () => undefined),
    listDrafts: vi.fn(async () => []),
  }
  return provider as typeof provider & MailProvider
}

let root: Root | null = null
let provider = recordingProvider()
const q = (selector: string) => document.querySelector<HTMLElement>(selector)
const qq = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
const tell = async (command: string, text = '') => {
  let answer!: { ok: boolean; say?: string }
  await act(async () => { answer = await held.handler!(command, text) })
  await settle()
  return answer
}
async function open(store: MailStore) {
  provider = recordingProvider()
  root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root!.render(
    <AppFrame>
      <PureMailShell initialProvider="demo" mailProvider={provider} initialStore={store} initialNotice={null as never} />
    </AppFrame>,
  ))
  await settle()
}
/** Nothing went out, and no draft reached the account either. */
function expectNothingSent() {
  expect(sends.sendDraft).not.toHaveBeenCalled()
  expect(provider.send).not.toHaveBeenCalled()
  expect(provider.createDraft).not.toHaveBeenCalled()
  expect(provider.updateDraft).not.toHaveBeenCalled()
}

beforeEach(() => {
  window.localStorage.clear()
  sends.sendDraft.mockClear()
  held.handler = null
  compact.on = true
  // The sample mail is from June: the list only reaches back a window from today.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-20T16:12:00.000Z') })
})
afterEach(async () => {
  vi.useRealTimers()
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('Mail answering the page that holds it', () => {
  it('shows the words searched for in place of the inbox, and Show inbox brings it back', async () => {
    const store = demoMailStore()
    const thread = store.threads.find(each => /roadmap|plan|brief|invoice|review/i.test(each.subject)) ?? store.threads[1]!
    const word = thread.subject.split(/\s+/).find(each => each.length > 4)!
    await open(store)
    const inbox = qq('[aria-label="Inbox"] [data-agent-ref]').length
    expect(inbox).toBeGreaterThan(0)
    const answer = await tell('search', word)
    expect(answer.ok).toBe(true)
    expect(answer.say).toMatch(new RegExp(`^(Showing \\d+ conversations? matching|Nothing in your mail matches) “${word}”\\.$`))
    expect(q('[aria-label="Search results"]')).not.toBeNull()
    expect(q('[aria-label="Search results"] h2')!.textContent).toContain(`“${word}”`)
    expect(document.body.textContent).toContain(thread.subject)
    await act(async () => qq('[aria-label="Search results"] header button').find(button => button.textContent === 'Show inbox')!.click())
    expect(q('[aria-label="Inbox"]')).not.toBeNull()
    expect(qq('[aria-label="Inbox"] [data-agent-ref]').length).toBe(inbox)
    expectNothingSent()
  })

  it('says plainly when nothing matches, and shows the inbox for no words', async () => {
    await open(demoMailStore())
    const none = await tell('search', 'zzzxxqq')
    expect(none).toEqual({ ok: true, say: 'Nothing in your mail matches “zzzxxqq”.' })
    expect(q('[aria-label="Search results"]')!.textContent).toContain('Nothing in your mail matches')
    expect(await tell('search', '  ')).toEqual({ ok: true, say: 'Showing your inbox.' })
    expect(q('[aria-label="Search results"]')).toBeNull()
    expect(q('[aria-label="Inbox"]')).not.toBeNull()
  })

  it('searches the full app the way its own search box does', async () => {
    compact.on = false
    await open(demoMailStore())
    const answer = await tell('search', 'from:mira@example.com')
    expect(answer.ok).toBe(true)
    expect(answer.say).toMatch(/^Showing \d+ conversations? matching “from:mira@example.com”\.$/)
  })

  it('opens the latest thread from a person with a reply open, and sends nothing', async () => {
    const store = demoMailStore()
    const fromMira = store.messages.filter(each => !each.isDraft && each.from.email === 'mira@example.com').sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]!
    const thread = store.threads.find(each => each.id === fromMira.threadId)!
    await open(store)
    const answer = await tell('reply', 'mira')
    expect(answer.ok).toBe(true)
    expect(answer.say).toBe(`Opened your latest thread from Mira, “${thread.subject}”, with a reply ready to write. Nothing is sent.`)
    expect(q('[aria-label="Inbox"]'), 'the list has given way to the thread').toBeNull()
    expect(document.body.textContent).toContain(thread.subject)
    const dock = q('[data-puremail-compose-dock]')
    expect(dock, 'a reply is open').not.toBeNull()
    expect(dock!.querySelector('[aria-label="To recipients"]')).not.toBeNull()
    expect(dock!.textContent).toContain('mira@example.com')
    // The reply waits for the person: even given time, nothing goes out and no draft reaches the account.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1800)) })
    expectNothingSent()
  })

  it('says there is no mail when nobody matches, and opens nothing', async () => {
    await open(demoMailStore())
    expect(await tell('reply', 'Zaphod')).toEqual({ ok: false, say: 'No mail from Zaphod here.' })
    expect(q('[aria-label="Inbox"]')).not.toBeNull()
    expect(q('[data-puremail-compose-dock]')).toBeNull()
    expectNothingSent()
  })

  it('does not take the person\'s own mail for mail from them', async () => {
    const store = demoMailStore()
    const own = store.accounts[0]!
    await open(store)
    expect(await tell('reply', own.email)).toEqual({ ok: false, say: `No mail from ${own.email} here.` })
    expectNothingSent()
  })

  it('asks whose mail when there is no name, and refuses what it does not know', async () => {
    await open(demoMailStore())
    expect(await tell('reply', '  ')).toEqual({ ok: false, say: 'Say whose mail to reply to, like: Mira.' })
    expect((await tell('send', 'now')).ok).toBe(false)
    expect((await tell('delete', 'everything')).ok).toBe(false)
    expectNothingSent()
  })
})
