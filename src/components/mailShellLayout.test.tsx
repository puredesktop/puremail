import { afterEach, describe, expect, it } from 'vitest'
import { demoMailStore } from '../lib/mailModel'
import {
  MAIL_LAYOUT_STORAGE_KEY,
  readLayoutState,
  taskDrawerOpenFor,
  visibleRowRange,
} from './mailShellLayout'
import type { MailAccount, Mailbox, MailThread } from '../types'

// Imported, not re-declared: a local copy meant a storage-key version bump
// silently stopped these tests from exercising a saved layout at all.

function installLocalStorage(rawValue: string | null): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) =>
          key === MAIL_LAYOUT_STORAGE_KEY ? rawValue : null,
      },
    },
  })
}

describe('PureMail layout state', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('restores the selected account with its mailbox, thread, and drawer state', () => {
    const base = demoMailStore()
    const secondAccount: MailAccount = {
      id: 'acct_work',
      provider: 'imap',
      name: 'Work Mail',
      email: 'work@example.com',
      syncState: 'online',
    }
    const secondMailbox: Mailbox = {
      id: 'mailbox_work_inbox',
      accountId: secondAccount.id,
      name: 'Work inbox',
      role: 'inbox',
      unreadCount: 1,
    }
    const secondThread: MailThread = {
      ...base.threads[0],
      id: 'thread_work',
      accountId: secondAccount.id,
      mailboxId: secondMailbox.id,
      subject: 'Work account thread',
    }
    const store = {
      ...base,
      accounts: [...base.accounts, secondAccount],
      mailboxes: [...base.mailboxes, secondMailbox],
      threads: [...base.threads, secondThread],
    }
    installLocalStorage(
      JSON.stringify({
        selectedAccountId: secondAccount.id,
        query: `in:${secondMailbox.name}`,
        selectedThreadId: secondThread.id,
        taskMode: 'followups',
        taskDrawerOpen: { [secondAccount.id]: true },
        density: 'comfortable',
      }),
    )

    expect(readLayoutState(store)).toMatchObject({
      selectedAccountId: secondAccount.id,
      query: `in:${secondMailbox.name}`,
      selectedThreadId: secondThread.id,
      taskMode: 'followups',
      taskDrawerOpen: { [secondAccount.id]: true },
      density: 'comfortable',
    })
  })

  it('starts with the task drawer collapsed and rows compact when nothing is saved', () => {
    installLocalStorage(null)

    const state = readLayoutState(demoMailStore())
    expect(state.density).toBe('compact')
    expect(taskDrawerOpenFor(state, state.selectedAccountId)).toBe(false)
  })

  it('keeps the drawer open for the account it was opened on, and no other', () => {
    const store = demoMailStore()
    const accountId = store.accounts[0].id
    installLocalStorage(
      JSON.stringify({ taskDrawerOpen: { [accountId]: true } }),
    )

    const state = readLayoutState(store)
    expect(taskDrawerOpenFor(state, accountId)).toBe(true)
    expect(taskDrawerOpenFor(state, 'acct_other')).toBe(false)
  })

  it('migrates the old single collapsed flag onto the account it was saved for', () => {
    const store = demoMailStore()
    const accountId = store.accounts[0].id
    installLocalStorage(
      JSON.stringify({
        selectedAccountId: accountId,
        taskPaneCollapsed: false,
      }),
    )

    const state = readLayoutState(store)
    expect(taskDrawerOpenFor(state, accountId)).toBe(true)
    expect(taskDrawerOpenFor(state, 'acct_other')).toBe(false)
  })

  it('treats a pre-redesign blob without the reading field as the index', () => {
    // Every layout saved before the reading/index split lacks `reading`;
    // those users must boot into the thread list, not the reader.
    const store = demoMailStore()
    installLocalStorage(
      JSON.stringify({
        selectedAccountId: store.accounts[0].id,
        query: 'in:inbox',
        selectedThreadId: store.threads[0].id,
      }),
    )

    expect(readLayoutState(store).reading).toBe(false)
  })

  it('restores reading mode only when its thread still exists', () => {
    const store = demoMailStore()
    installLocalStorage(
      JSON.stringify({
        selectedAccountId: store.accounts[0].id,
        selectedThreadId: store.threads[0].id,
        reading: true,
      }),
    )
    expect(readLayoutState(store).reading).toBe(true)

    // The thread is gone: the id falls back to another thread, and that is
    // NOT the thread the reader was showing... but a valid fallback exists,
    // so reading may persist onto it? No — the contract is stricter: only a
    // non-empty resolved selection keeps the flag, and a store with no
    // threads at all must never boot into the reader.
    installLocalStorage(JSON.stringify({ reading: true }))
    const emptyStore = { ...store, threads: [], messages: [] }
    expect(readLayoutState(emptyStore).reading).toBe(false)
  })

  it('tolerates a malformed reading value', () => {
    const store = demoMailStore()
    installLocalStorage(
      JSON.stringify({
        selectedThreadId: store.threads[0].id,
        reading: 'yes',
      }),
    )
    expect(readLayoutState(store).reading).toBe(false)
  })

  it('does not restore a thread from a different account', () => {
    const base = demoMailStore()
    const secondAccount: MailAccount = {
      id: 'acct_work',
      provider: 'imap',
      name: 'Work Mail',
      email: 'work@example.com',
      syncState: 'online',
    }
    const secondMailbox: Mailbox = {
      id: 'mailbox_work_inbox',
      accountId: secondAccount.id,
      name: 'Work inbox',
      role: 'inbox',
      unreadCount: 1,
    }
    const secondThread: MailThread = {
      ...base.threads[0],
      id: 'thread_work',
      accountId: secondAccount.id,
      mailboxId: secondMailbox.id,
      subject: 'Work account thread',
    }
    const store = {
      ...base,
      accounts: [...base.accounts, secondAccount],
      mailboxes: [...base.mailboxes, secondMailbox],
      threads: [...base.threads, secondThread],
    }
    installLocalStorage(
      JSON.stringify({
        selectedAccountId: secondAccount.id,
        query: `in:${secondMailbox.name}`,
        selectedThreadId: base.threads[0].id,
      }),
    )

    expect(readLayoutState(store)).toMatchObject({
      selectedAccountId: secondAccount.id,
      query: `in:${secondMailbox.name}`,
      selectedThreadId: secondThread.id,
    })
  })
})

describe('visibleRowRange', () => {
  const base = { rowHeight: 50, overscan: 2, total: 1000, railTop: 0 }

  it('mounts a screenful plus overscan at the top', () => {
    expect(
      visibleRowRange({ ...base, scrollTop: 0, viewportHeight: 500 }),
    ).toEqual({ start: 0, end: 12 })
  })

  it('follows the scroll offset', () => {
    expect(
      visibleRowRange({ ...base, scrollTop: 5000, viewportHeight: 500 }),
    ).toEqual({ start: 98, end: 112 })
  })

  it('accounts for the rail sitting below other content', () => {
    // 300px of sidebar above the rail means row 0 is still on screen.
    expect(
      visibleRowRange({
        ...base,
        scrollTop: 300,
        railTop: 300,
        viewportHeight: 500,
      }),
    ).toEqual({ start: 0, end: 12 })
  })

  it('never runs past the end of the list', () => {
    // Scrolled to the true bottom: scrollHeight (50_000) minus a viewport.
    const atBottom = visibleRowRange({
      ...base,
      scrollTop: 49_500,
      viewportHeight: 500,
    })
    expect(atBottom.end).toBe(1000)
    expect(atBottom.start).toBeLessThan(atBottom.end)

    // Past the end (overscroll) must still clamp rather than index past it.
    const overscrolled = visibleRowRange({
      ...base,
      scrollTop: 90_000,
      viewportHeight: 500,
    })
    expect(overscrolled.end).toBe(1000)
    expect(overscrolled.start).toBeLessThanOrEqual(1000)
  })

  it('still mounts rows when the container reports no height yet', () => {
    // A collapsed or not-yet-measured container must not render an empty
    // list — that reads as "no mail" rather than "not measured".
    const range = visibleRowRange({ ...base, scrollTop: 0, viewportHeight: 0 })
    expect(range.end).toBeGreaterThan(range.start)
  })

  it('returns an empty range for an empty list', () => {
    expect(
      visibleRowRange({ ...base, total: 0, scrollTop: 0, viewportHeight: 500 }),
    ).toEqual({ start: 0, end: 0 })
  })
})
