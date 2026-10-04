// @vitest-environment happy-dom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MailTopBar, type MailTopBarProps } from './MailTopBar'
import { emptyMailStore } from '../lib/mailStoreData'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const container = document.createElement('div')
let root = createRoot(container)
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(container) })
const hit = { threadId: 'remote', subject: 'Older invoice', from: 'a@example.com', date: '2020-01-01', snippet: '', inLocalWindow: false }
function props(): MailTopBarProps {
  return { store: emptyMailStore(), selectedAccount: null, selectedAccountId: 'a', switchAccount: vi.fn(),
    searchInputRef: createRef(), searchPanelOpen: true, setSearchPanelOpen: vi.fn(), currentQuery: 'invoice',
    setCurrentQuery: vi.fn(), setStore: vi.fn(), runMailCommand: vi.fn(), openThread: vi.fn(), searchGmail: null,
    searchAllMail: vi.fn(async () => [hit]), importRemoteThread: vi.fn(async () => null), refreshMail: vi.fn(),
    mailFetching: false, mailFetchDisabled: false, density: 'compact', setDensity: vi.fn(), openSettings: vi.fn() }
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(text))!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}
describe('server search results', () => {
  it('keeps recovery reachable from the account menu after a toast is dismissed', async () => {
    const p = props()
    const openRecovery = vi.fn()
    await act(async () => root.render(<MailTopBar {...p} openRecovery={openRecovery} />))
    const account = container.querySelector('[aria-label="Mail account menu"]') as HTMLButtonElement | null
    expect(account).toBeTruthy()
    await act(async () => account!.click())
    await click('Mail recovery')
    expect(openRecovery).toHaveBeenCalledOnce()
  })
  it('keeps the search open and shows an error when importing returns no message', async () => {
    const p = props()
    await act(async () => root.render(<MailTopBar {...p} />))
    await click('Search all mail')
    await click('Older invoice')
    expect(p.openThread).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded')
  })
  it('ignores a response after the query changes', async () => {
    const p = props()
    let finish!: (value: typeof hit[]) => void
    p.searchAllMail = vi.fn(() => new Promise<typeof hit[]>(resolve => { finish = resolve }))
    await act(async () => root.render(<MailTopBar {...p} />))
    await click('Search all mail')
    await act(async () => root.render(<MailTopBar {...p} currentQuery="different" />))
    await act(async () => finish([hit]))
    expect(container.textContent).not.toContain('Older invoice')
    expect(container.textContent).not.toContain('Searching all mail…')
  })
  it('opens the returned thread only after its message has loaded', async () => {
    const p = props()
    p.importRemoteThread = vi.fn(async () => ({ threads: [{ id: 'loaded' } as never], messages: [{}] }))
    await act(async () => root.render(<MailTopBar {...p} />))
    await click('Search all mail')
    await click('Older invoice')
    expect(p.importRemoteThread).toHaveBeenCalledWith('remote')
    expect(p.openThread).toHaveBeenCalledWith('loaded')
  })
})
