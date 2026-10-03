// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MailDeliveryStatus } from './MailDeliveryStatus'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('shows offline and failed sends, and keeps send failure after incoming connection recovers', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); const open = vi.fn()
  const draft = { id: 'd', subject: 'My reply', sendError: 'SMTP authentication failed' } as never
  const props = { connected: true, checking: false, checked: true, syncError: null, failedDrafts: [draft], sendingCount: 0, onCheck: vi.fn(), onOpenDraft: open }
  try {
    await act(async () => root.render(<MailDeliveryStatus {...props} offline />))
    expect(host.textContent).toContain('Offline')
    expect(host.textContent).toContain('1 message needs attention — send not confirmed')
    await act(async () => root.render(<MailDeliveryStatus {...props} offline={false} />))
    expect(host.textContent).not.toContain('Offline')
    expect(host.textContent).toContain('SMTP authentication failed')
    await act(async () => host.querySelector('button')!.click())
    expect(open).toHaveBeenCalledWith(draft)
    await act(async () => root.render(<MailDeliveryStatus {...props} offline={false} failedDrafts={[]} />))
    expect(host.textContent).toBe('')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('makes mailbox connection failure persistent and offers an explicit check', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); const check = vi.fn()
  const props = { connected: true, offline: false, checked: true, failedDrafts: [], sendingCount: 0, onCheck: check, onOpenDraft: vi.fn() }
  try {
    await act(async () => root.render(<MailDeliveryStatus {...props} checking={false} syncError="Server unavailable" />))
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(host.textContent).toContain('Cannot reach your mailbox')
    await act(async () => host.querySelector('button')!.click())
    expect(check).toHaveBeenCalledTimes(1)
    await act(async () => root.render(<MailDeliveryStatus {...props} checking syncError="Server unavailable" />))
    expect(host.querySelector('button')!.disabled).toBe(true)
    await act(async () => root.render(<MailDeliveryStatus {...props} checking={false} syncError={null} sendingCount={2} />))
    expect(host.textContent).toContain('Sending 2 messages… awaiting confirmation')
    expect(host.textContent).not.toContain('sent.')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('keeps the connection test visible and distinguishes SMTP failure from receiving health', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); const test = vi.fn()
  const props = { connected: true, offline: false, checked: true, checking: false, syncError: null, failedDrafts: [], sendingCount: 0, onCheck: vi.fn(), onOpenDraft: vi.fn(), onTest: test }
  try {
    await act(async () => root.render(<MailDeliveryStatus {...props} />))
    expect(host.textContent).toContain('Sending not checked')
    await act(async () => host.querySelector('button')!.click())
    expect(test).toHaveBeenCalledOnce()
    await act(async () => root.render(<MailDeliveryStatus {...props} connectionTest={{ receiving: 'IMAP connection verified', sending: 'Failed: SMTP authentication failed' }} />))
    expect(host.textContent).toContain('Receiving: IMAP connection verified')
    expect(host.textContent).toContain('Sending: Failed: SMTP authentication failed')
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    await act(async () => root.render(<MailDeliveryStatus {...props} testing />))
    expect(host.querySelector('button')!.disabled).toBe(true)
  } finally { await act(async () => root.unmount()); host.remove() }
})
